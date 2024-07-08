const { Kafka } = require('kafkajs');
const dotenv = require('dotenv').config();
const { SchemaRegistry } = require('@kafkajs/confluent-schema-registry');
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

const getDlqTopicName = async (topicId) => {
  const result = await db.query('SELECT topic_name FROM topics WHERE id = $1', [topicId]);
  if (result.rowCount === 0) {
    throw new Error(`DLQ topic with id ${topicId} not found`);
  }
  return result.rows[0].topic_name;
};

const applyTransformations = async (message, steps, dlqSteps) => {
  let transformedMessage = { ...message };
  for (let i = 0; i < steps.length; i++) {
    const processorName = await getProcessorName(steps[i]);
    const transformation = require(`./transformations/${processorName}`);
    transformedMessage = transformation(transformedMessage);
    console.log('ran process ' + processorName);
    console.log(transformedMessage);

    if (!transformedMessage && dlqSteps[i]) {
      const dlqTopicName = await getDlqTopicName(dlqSteps[i]);
      return { dlqMessage: message, dlqTopicName };
    }
  }
  return { transformedMessage };
};

const processBatch = async (messages, steps, dlqSteps, targetTopic, schemaId) => {
  const transformedMessages = await Promise.all(
    messages.map(async ({ key, value }) => {
      try {
        const decodedMessage = await registry.decode(value);
        const { transformedMessage, dlqMessage, dlqTopicName } = await applyTransformations(decodedMessage, steps, dlqSteps);

        if (dlqMessage) {
          const encodedDlqValue = await registry.encode(schemaId, dlqMessage);
          return { key: decodedMessage.key, value: encodedDlqValue, dlqTopicName };
        }

        const encodedValue = await registry.encode(schemaId, transformedMessage);
        return { key: decodedMessage.key, value: encodedValue, dlqTopicName: null };
      } catch (error) {
        console.error(`Failed to process message with key ${key}:`, error);
        return null;
      }
    })
  );

  const validMessages = transformedMessages.filter(msg => msg !== null && !msg.dlqTopicName);
  const dlqMessages = transformedMessages.filter(msg => msg !== null && msg.dlqTopicName);

  if (validMessages.length > 0) {
    await producer.send({
      topic: targetTopic,
      messages: validMessages.map(({ key, value }) => ({ key, value })),
    });

    console.log(`Produced ${validMessages.length} transformed messages`);
  }

  for (const dlqMessage of dlqMessages) {
    await producer.send({
      topic: dlqMessage.dlqTopicName,
      messages: [{ key: dlqMessage.key, value: dlqMessage.value }],
    });

    console.log(`Produced DLQ message to ${dlqMessage.dlqTopicName}`);
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
          const task = processBatch(messages, steps.processors, steps.dlq, targetTopic, outgoingSchemaId);
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
        const task = processBatch(messages, steps.processors, steps.dlq, targetTopic, outgoingSchemaId);
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