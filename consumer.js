const { Kafka } = require('kafkajs');
const dotenv = require('dotenv').config();
const { SchemaRegistry, readAVSCAsync } = require('@kafkajs/confluent-schema-registry');
const db = require('./db');

const APIKEY = process.env.APIKEY;
const APISECRET = process.env.APISECRET;
const BROKER = process.env.BROKER;
const REGISTRY_URL = process.env.REGISTRY_URL;
const REGISTRY_APIKEY = process.env.REGISTRY_APIKEY;
const REGISTRY_APISECRET = process.env.REGISTRY_APISECRET;

const kafka = new Kafka({
  clientId: 'my-consumer',
  brokers: [BROKER],
  ssl: true,
  sasl: {
    mechanism: 'plain',
    username: APIKEY,
    password: APISECRET
  }
});

const producer = kafka.producer();
const registry = new SchemaRegistry({
  host: REGISTRY_URL,
  auth: {
    username: REGISTRY_APIKEY,
    password: REGISTRY_APISECRET
  }
});

const getProcessorName = async (processorId) => {
  const result = await db.query('SELECT processor_name FROM processors WHERE id = $1', [processorId]);
  if (result.rowCount === 0) {
    throw new Error(`Processor with id ${processorId} not found`);
  }
  return result.rows[0].processor_name;
};

const applyTransformations = async (message, steps) => {
  let transformedMessage = { ...message };
  for (const step of steps) {
    const processorName = await getProcessorName(step);
    const transformation = require(`./transformations/${processorName}`);
    transformedMessage = transformation(transformedMessage);
  }
  return transformedMessage;
};

const processBatch = async (messages, steps, targetTopic, schemaId) => {
  const transformedMessages = await Promise.all(
    messages.map(async ({ key, value }) => {
      try {
        const decodedMessage = await registry.decode(value);
        const transformedValue = await applyTransformations(decodedMessage, steps);
        const encodedValue = await registry.encode(schemaId, transformedValue);
        return { key: decodedMessage.key, value: encodedValue };
      } catch (error) {
        console.error(`Failed to process message with key ${key}:`, error);
        return null;
      }
    })
  );

  const validMessages = transformedMessages.filter(msg => msg !== null);

  if (validMessages.length > 0) {
    await producer.send({
      topic: targetTopic,
      messages: validMessages,
    });

    console.log(`Produced ${validMessages.length} transformed messages`);
  }
};

const run = async (sourceTopic, targetTopic, steps, incomingSchema, outgoingSchema) => {
  console.log('Running consumer with:', { sourceTopic, targetTopic, steps, incomingSchema, outgoingSchema });

  const consumer = kafka.consumer({ groupId: `${sourceTopic}-group` });
  await consumer.connect();
  await producer.connect();
  await consumer.subscribe({ topic: sourceTopic, fromBeginning: true });

  let incomingSchemaId, outgoingSchemaId;
  try {
    incomingSchemaId = await registry.getLatestSchemaId(incomingSchema);
    outgoingSchemaId = await registry.getLatestSchemaId(outgoingSchema);
  } catch (error) {
    console.error('Failed to fetch schema IDs:', error);
    return;
  }

  const batchSize = 100;
  const concurrency = 5;

  let messages = [];
  let processingTasks = [];

  await consumer.run({
    eachBatchAutoResolve: false,
    eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary }) => {
      console.log(`Received batch with ${batch.messages.length} messages`);
      for (let message of batch.messages) {
        messages.push({
          key: message.key ? message.key.toString() : null,
          value: message.value,
        });

        if (messages.length >= batchSize) {
          const task = processBatch(messages, steps, targetTopic, outgoingSchemaId);
          processingTasks.push(task);

          if (processingTasks.length >= concurrency) {
            await Promise.all(processingTasks);
            processingTasks = [];
          }

          messages = [];
        }

        resolveOffset(message.offset);
        await heartbeat();
      }

      if (messages.length > 0) {
        const task = processBatch(messages, steps, targetTopic, outgoingSchemaId);
        await task;
        messages = [];
      }

      await commitOffsetsIfNecessary();
    },
  });

  console.log('Consumer is running');
};

const shutdown = async () => {
  console.log('Processor shutdown initiated');
  try {
    await producer.disconnect();
    console.log('Successfully disconnected Kafka producer');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown', error);
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = run;