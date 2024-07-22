const { Kafka, CompressionTypes, Partitioners } = require('kafkajs');
const dotenv = require('dotenv').config();
const { SchemaRegistry } = require('@kafkajs/confluent-schema-registry');

const APIKEY = process.env.APIKEY;
const APISECRET = process.env.APISECRET;
const BROKER = process.env.BROKER;
const REGISTRY_URL = process.env.REGISTRY_URL;
const REGISTRY_APIKEY = process.env.REGISTRY_APIKEY;
const REGISTRY_APISECRET = process.env.REGISTRY_APISECRET;

const SOURCE_TOPIC = 'source_a';
const TARGET_TOPIC = 'target_a';
const PIPELINE_ID = '10';

const kafka = new Kafka({
  clientId: 'load-test-client',
  brokers: [BROKER],
  ssl: true,
  sasl: {
    mechanism: 'plain',
    username: APIKEY,
    password: APISECRET
  }
});

const producer = kafka.producer({
  createPartitioner: Partitioners.DefaultPartitioner,
  allowAutoTopicCreation: false,
  transactionTimeout: 30000,
  maxInFlightRequests: 5,
  idempotent: true,
});

const consumer = kafka.consumer({ groupId: 'load-test-consumer' });

const registry = new SchemaRegistry({
  host: REGISTRY_URL,
  auth: {
    username: REGISTRY_APIKEY,
    password: REGISTRY_APISECRET
  }
});

let totalProduced = 0;
let totalConsumed = 0;
let produceStartTime;
let consumeStartTime;
let lastConsumeTime;

async function produceMessages(duration) {
  await producer.connect();
  let schemaId;
  try {
    schemaId = await registry.getLatestSchemaId('schema_a');
  } catch (error) {
    console.error('Failed to fetch the latest schema ID:', error);
    return;
  }
  
  const batchSize = 5000;
  const concurrentBatches = 5;
  let batchNumber = 0;
  const endTime = Date.now() + duration;

  produceStartTime = process.hrtime.bigint();

  while (Date.now() < endTime) {
    const batchPromises = [];
    for (let j = 0; j < concurrentBatches; j++) {
      const messages = [];
      for (let i = 0; i < batchSize; i++) {
        const key = `key-${batchNumber}-${i}`;
        const value = `value-${batchNumber}-${i}`;
        const num = batchNumber * batchSize + i;
        const message = { key, value, num };
        const encodedValue = await registry.encode(schemaId, message);
        messages.push({ key: Buffer.from(key), value: encodedValue });
      }
      
      const sendPromise = producer.send({
        topic: SOURCE_TOPIC,
        messages: messages,
        compression: CompressionTypes.GZIP,
      });
      
      batchPromises.push(sendPromise);
      batchNumber++;
    }
    
    await Promise.all(batchPromises);
    
    totalProduced += batchSize * concurrentBatches;
    console.log(`Produced ${concurrentBatches} batches with ${batchSize * concurrentBatches} messages. Total: ${totalProduced}`);
  }
}

async function consumeMessages() {
  await consumer.connect();
  await consumer.subscribe({ topic: TARGET_TOPIC, fromBeginning: true });

  consumeStartTime = process.hrtime.bigint();
  lastConsumeTime = consumeStartTime;

  await consumer.run({
    eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
      for (let message of batch.messages) {
        if (!isRunning() || isStale()) break;
        totalConsumed++;
        resolveOffset(message.offset);
        await heartbeat();
      }

      const now = process.hrtime.bigint();
      const duration = Number(now - lastConsumeTime) / 1e9;
      if (duration >= 1) {
        const rate = Math.round((totalConsumed / Number(now - consumeStartTime) * 1e9));
        console.log(`Consumed total: ${totalConsumed}, Current rate: ${rate} messages/sec`);
        lastConsumeTime = now;
      }
    },
  });
}

async function runLoadTest(durationSeconds) {
  console.log(`Starting load test for ${durationSeconds} seconds`);
  
  const consumePromise = consumeMessages().catch(console.error);
  await new Promise(resolve => setTimeout(resolve, 1000));
  await produceMessages(durationSeconds * 1000);
  
  // Wait for consumption to catch up
  const maxWaitTime = 60000; // 60 seconds
  const waitInterval = 1000; // 1 second
  let waitedTime = 0;
  while (totalConsumed < totalProduced && waitedTime < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, waitInterval));
    waitedTime += waitInterval;
  }

  const endTime = process.hrtime.bigint();
  const produceDuration = Number(endTime - produceStartTime) / 1e9;
  const consumeDuration = Number(endTime - consumeStartTime) / 1e9;

  console.log(`Load test completed`);
  console.log(`Total messages produced: ${totalProduced}`);
  console.log(`Total messages consumed: ${totalConsumed}`);
  console.log(`Production rate: ${(totalProduced / produceDuration).toFixed(2)} messages/sec`);
  console.log(`Overall consumption rate: ${(totalConsumed / consumeDuration).toFixed(2)} messages/sec`);
  console.log(`Processing lag: ${totalProduced - totalConsumed} messages`);

  await producer.disconnect();
  await consumer.disconnect();
  process.exit(0);
}

// pass duration in seconds of test as arg below
runLoadTest(5).catch(console.error);