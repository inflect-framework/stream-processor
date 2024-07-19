const { Kafka } = require('kafkajs');
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

const producer = kafka.producer();
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
let startTime;

async function produceMessages(duration) {
  await producer.connect();

  let schemaId;
  try {
    schemaId = await registry.getLatestSchemaId('schema_a');
  } catch (error) {
    console.error('Failed to fetch the latest schema ID:', error);
    return;
  }

  startTime = Date.now();
  let batchNumber = 0;

  while (Date.now() - startTime < duration) {
    const batchSize = 1000;
    const messages = [];
    for (let i = 0; i < batchSize; i++) {
      const key = `key-${batchNumber}-${i}`;
      const value = `value-${batchNumber}-${i}`;
      const num = batchNumber * batchSize + i;
      const message = { key, value, num };
      const encodedValue = await registry.encode(schemaId, message);

      messages.push({ key: Buffer.from(key), value: encodedValue });
    }

    await producer.send({
      topic: SOURCE_TOPIC,
      messages: messages,
    });

    totalProduced += messages.length;
    console.log(`Produced batch ${batchNumber} with ${messages.length} messages. Total: ${totalProduced}`);
    
    batchNumber++;
  }
}

async function consumeMessages() {
  await consumer.connect();
  await consumer.subscribe({ topic: TARGET_TOPIC, fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      totalConsumed++;
      if (totalConsumed % 1000 === 0) {
        console.log(`Consumed total: ${totalConsumed}`);
      }
    },
  });
}

async function runLoadTest(durationSeconds) {
  console.log(`Starting load test for ${durationSeconds} seconds`);
  
  consumeMessages().catch(console.error);
  await new Promise(resolve => setTimeout(resolve, 1000));
  await produceMessages(durationSeconds * 1000);
  await new Promise(resolve => setTimeout(resolve, 5000));

  const duration = (Date.now() - startTime) / 1000;
  console.log(`Load test completed in ${duration} seconds`);
  console.log(`Total messages produced: ${totalProduced}`);
  console.log(`Total messages consumed: ${totalConsumed}`);
  console.log(`Production rate: ${(totalProduced / duration).toFixed(2)} messages/sec`);
  console.log(`Consumption rate: ${(totalConsumed / duration).toFixed(2)} messages/sec`);
  console.log(`Processing lag: ${totalProduced - totalConsumed} messages`);

  await producer.disconnect();
  await consumer.disconnect();
  process.exit(0);
}

// pass duration in seconds of test as arg below
runLoadTest(10).catch(console.error);