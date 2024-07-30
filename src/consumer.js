const { Kafka } = require('kafkajs');
const dotenv = require('dotenv').config();
const { SchemaRegistry } = require('@kafkajs/confluent-schema-registry');
const db = require('./db');
const { 
  messagesReceivedCounter, 
  processorsAppliedCounter,
  messagesCompletedCounter,
  messagesErrorCounter, 
  messagesDlqCounter, 
  messagesDroppedCounter,
  messageProcessingDuration 
} = require('./metrics');

const APIKEY = process.env.APIKEY;
const APISECRET = process.env.APISECRET;
const BROKER = process.env.BROKER;
const REGISTRY_URL = process.env.REGISTRY_URL;
const REGISTRY_APIKEY = process.env.REGISTRY_APIKEY;
const REGISTRY_APISECRET = process.env.REGISTRY_APISECRET;
const PIPELINE_ID = process.env.PIPELINE_ID;
const POD_NAME = process.env.HOSTNAME || 'unknown-pod';

const kafka = new Kafka({
  clientId: `consumer-${POD_NAME}`,
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

const processorNameCache = new Map();
const dlqTopicNameCache = new Map();
const schemaCache = new Map();

const getProcessorName = async (processorId) => {
  if (processorNameCache.has(processorId)) {
    return processorNameCache.get(processorId);
  }
  
  const client = await db.pool.connect();
  try {
    const result = await client.query('SELECT processor_name FROM processors WHERE id = $1', [processorId]);
    if (result.rowCount === 0) {
      throw new Error(`Processor with id ${processorId} not found`);
    }
    const processorName = result.rows[0].processor_name;
    processorNameCache.set(processorId, processorName);
    return processorName;
  } finally {
    client.release();
  }
};

const getDlqTopicName = async (topicId) => {
  if (dlqTopicNameCache.has(topicId)) {
    return dlqTopicNameCache.get(topicId);
  }
  
  const client = await db.pool.connect();
  try {
    const result = await client.query('SELECT topic_name FROM topics WHERE id = $1', [topicId]);
    if (result.rowCount === 0) {
      throw new Error(`DLQ topic with id ${topicId} not found`);
    }
    const topicName = result.rows[0].topic_name;
    dlqTopicNameCache.set(topicId, topicName);
    return topicName;
  } finally {
    client.release();
  }
};

const applyTransformationsAsync = async (message, steps, dlqSteps) => {
  let transformedMessage = { ...message };
  
  for (let i = 0; i < steps.length; i++) {
    const processorName = await getProcessorName(steps[i]);
    const transformation = require(`./transformations/${processorName}`);
    const start = process.hrtime();
    try {
      transformedMessage = await transformation(transformedMessage);
      processorsAppliedCounter.inc({ pipeline_id: PIPELINE_ID, pod_name: POD_NAME, processor_name: processorName });
    } catch (error) {
      console.error(`Error in transformation ${processorName}:`, error);
      if (dlqSteps && dlqSteps[i]) {
        const dlqTopicName = await getDlqTopicName(dlqSteps[i]);
        return { dlqMessage: message, dlqTopicName };
      } else {
        throw new Error(`Transformation ${processorName} failed`);
      }
    } finally {
      const end = process.hrtime(start);
      const duration = end[0] + end[1] / 1e9;
      messageProcessingDuration.observe({ pipeline_id: PIPELINE_ID, pod_name: POD_NAME, step: processorName }, duration);
    }
  }

  return { transformedMessage };
};

const processMessage = async (message, steps, dlqSteps, schemaId) => {
  const start = process.hrtime();
  try {
    let decodedMessage;
    if (schemaCache.has(schemaId)) {
      decodedMessage = await registry.decode(message.value, schemaCache.get(schemaId));
    } else {
      const schema = await registry.getSchema(schemaId);
      schemaCache.set(schemaId, schema);
      decodedMessage = await registry.decode(message.value, schema);
    }

    const { transformedMessage, dlqMessage, dlqTopicName } = await applyTransformationsAsync(decodedMessage, steps, dlqSteps);

    if (dlqMessage) {
      messagesDlqCounter.inc({ pipeline_id: PIPELINE_ID, pod_name: POD_NAME });
      const encodedDlqValue = await registry.encode(schemaId, dlqMessage);
      return { key: decodedMessage.key, value: encodedDlqValue, dlqTopicName };
    }

    if (!transformedMessage) {
      messagesDroppedCounter.inc({ pipeline_id: PIPELINE_ID, pod_name: POD_NAME });
      return null;
    }

    const encodedValue = await registry.encode(schemaId, transformedMessage);
    messagesCompletedCounter.inc({ pipeline_id: PIPELINE_ID, pod_name: POD_NAME });
    return { key: decodedMessage.key, value: encodedValue, dlqTopicName: null };
  } catch (error) {
    messagesErrorCounter.inc({ pipeline_id: PIPELINE_ID, pod_name: POD_NAME });
    console.error(`Failed to process message with key ${message.key}:`, error);
    return null;
  } finally {
    const end = process.hrtime(start);
    const duration = end[0] + end[1] / 1e9;
    messageProcessingDuration.observe({ pipeline_id: PIPELINE_ID, pod_name: POD_NAME, step: 'total' }, duration);
  }
};

const processBatch = async (messages, steps, dlqSteps, targetTopic, schemaId) => {
  const results = await Promise.all(messages.map(message => processMessage(message, steps, dlqSteps, schemaId)));

  const validMessages = results.filter(msg => msg !== null && !msg.dlqTopicName);
  const dlqMessages = results.filter(msg => msg !== null && msg.dlqTopicName);

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

  return results.length;
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
  if (!PIPELINE_ID) {
    throw new Error('PIPELINE_ID environment variable is not set');
  }

  console.log(`Running consumer for pipeline ${PIPELINE_ID} with:`, { sourceTopic, targetTopic, steps, incomingSchema, outgoingSchema });

  const consumer = kafka.consumer({
    groupId: `pipeline-${PIPELINE_ID}-${sourceTopic}-group`,
    sessionTimeout: 30000,
    heartbeatInterval: 3000,
    maxPartitionFetchBytes: 10485760,
    fetchMaxBytes: 52428800,
    fetchMinBytes: 1,
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

  const batchSize = 5000;

  await consumer.run({
    eachBatchAutoResolve: false,
    eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary, isRunning, isStale }) => {
      let messages = [];
      let lastOffset;

      for (let message of batch.messages) {
        if (!isRunning() || isStale()) break;

        messages.push({
          key: message.key ? message.key.toString() : null,
          value: message.value,
        });

        lastOffset = message.offset;

        if (messages.length >= batchSize) {
          messagesReceivedCounter.inc({ pipeline_id: PIPELINE_ID, pod_name: POD_NAME }, messages.length);
          await processBatch(messages, steps.processors, steps.dlq, targetTopic, outgoingSchemaId);
          messages = [];
          await commitOffsetsIfNecessary();
        }

        await heartbeat();
      }

      if (messages.length > 0) {
        messagesReceivedCounter.inc({ pipeline_id: PIPELINE_ID, pod_name: POD_NAME }, messages.length);
        await processBatch(messages, steps.processors, steps.dlq, targetTopic, outgoingSchemaId);
      }

      resolveOffset(lastOffset);
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