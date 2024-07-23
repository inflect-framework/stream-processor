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
const PIPELINE_ID = process.env.PIPELINE_ID;
const POD_NAME = process.env.HOSTNAME || 'unknown-pod';

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
    try {
      transformedMessage = transformation(transformedMessage);
    } catch (error) {
      console.error(`Error in transformation ${processorName}:`, error);
      if (dlqSteps && dlqSteps[i]) {
        const dlqTopicName = await getDlqTopicName(dlqSteps[i]);
        return { dlqMessage: message, dlqTopicName };
      } else {
        return { transformedMessage: null };
      }
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

        if (!transformedMessage) {
          return null;
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
  }

  for (const dlqMessage of dlqMessages) {
    await producer.send({
      topic: dlqMessage.dlqTopicName,
      messages: [{ key: dlqMessage.key, value: dlqMessage.value }],
    });

    console.log(`Produced DLQ message to ${dlqMessage.dlqTopicName}`);
  }

};


let messageCount = 0;

setInterval(() => {
  const startTime = Date.now();
  const countAtStart = messageCount;

  setTimeout(() => {
    const elapsedTime = (Date.now() - startTime) / 1000;
    const newMessages = messageCount - countAtStart;
    const throughput = newMessages / elapsedTime;
    console.log(`Throughput: ${throughput.toFixed(2)} messages/second`);
  }, 10000);
}, 10000);

const run = async (sourceTopic, targetTopic, steps, incomingSchema, outgoingSchema) => {
  const pipelineId = process.env.PIPELINE_ID;
  if (!pipelineId) {
    throw new Error('PIPELINE_ID environment variable is not set');
  }

  console.log(`Running consumer for pipeline ${pipelineId} with:`, { sourceTopic, targetTopic, steps, incomingSchema, outgoingSchema });

  const consumer = kafka.consumer({
    groupId: `pipeline-${pipelineId}-${sourceTopic}-group`,
    sessionTimeout: 30000,
    heartbeatInterval: 3000,
    maxPartitionFetchBytes: 10485760,
    fetchMaxBytes: 52428800,
    fetchMinBytes: 1,
    maxPollRecords: 10000,
    maxPollIntervalMs: 300000,
  });
  

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

  const batchSize = 1000;

  await consumer.run({
    eachBatchAutoResolve: false,
    eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary }) => {
      let messages = [];

      for (let message of batch.messages) {
        messages.push({
          key: message.key ? message.key.toString() : null,
          value: message.value,
        });

        if (messages.length >= batchSize) {
          await processBatch(messages, steps.processors, steps.dlq, targetTopic, outgoingSchemaId);
          messageCount += messages.length;
          messages = [];
        }

        resolveOffset(message.offset);
        await heartbeat();
      }

      if (messages.length > 0) {
        await processBatch(messages, steps.processors, steps.dlq, targetTopic, outgoingSchemaId);
        messageCount += messages.length;
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
    await db.pool.end();
    console.log('Successfully closed database pool');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown', error);
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = run;