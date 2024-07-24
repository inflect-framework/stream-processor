const { Kafka, CompressionTypes, logLevel } = require("kafkajs");
const dotenv = require("dotenv").config();
const {
  SchemaRegistry,
  SchemaType,
} = require("@kafkajs/confluent-schema-registry");
const { messageCounter } = require("../src/metrics");

const CONFIG = {
  eventsPerBatch: 25000,
  delayBetweenBatches: 200,
  totalEvents: 0,
  numberOfProducers: 4,
  rampUpDelay: 10000,
  maxRetries: 5,
  initialRetryTime: 100,
};

const APIKEY = process.env.APIKEY;
const APISECRET = process.env.APISECRET;
const BROKER = process.env.BROKER;
const REGISTRY_URL = process.env.REGISTRY_URL;
const REGISTRY_APIKEY = process.env.REGISTRY_APIKEY;
const REGISTRY_APISECRET = process.env.REGISTRY_APISECRET;

const kafka = new Kafka({
  clientId: "json-producer",
  brokers: [BROKER],
  ssl: true,
  sasl: {
    mechanism: "plain",
    username: APIKEY,
    password: APISECRET,
  },
  logLevel: logLevel.ERROR,
});

const registry = new SchemaRegistry({
  host: REGISTRY_URL,
  auth: {
    username: REGISTRY_APIKEY,
    password: REGISTRY_APISECRET,
  },
});

const createProducer = () => kafka.producer({
  allowAutoTopicCreation: false,
  transactionTimeout: 30000,
});

const exponentialBackoff = (retryCount) => {
  return Math.min(CONFIG.initialRetryTime * Math.pow(2, retryCount), 30000); // Max 30 seconds
};

const produceMessages = async (producer, schemaId, batchNumber, producerId) => {
  const messages = [];
  for (let i = 0; i < CONFIG.eventsPerBatch; i++) {
    const key = `key-${producerId}-${batchNumber}-${i}`;
    const value = `value-${producerId}-${batchNumber}-${i}`;
    const num = batchNumber * CONFIG.eventsPerBatch + i;
    const message = { key, value, num };
    const encodedValue = await registry.encode(schemaId, message);

    messages.push({ key: Buffer.from(key), value: encodedValue });
  }

  let retries = 0;
  while (retries <= CONFIG.maxRetries) {
    try {
      await producer.send({
        topic: "source_a",
        messages: messages,
        compression: CompressionTypes.GZIP,
      });
      console.log(
        `Producer ${producerId}: Produced batch ${batchNumber} with ${messages.length} messages`
      );
      return messages.length;
    } catch (error) {
      console.error(`Producer ${producerId}: Error sending batch ${batchNumber}:`, error);
      retries++;
      if (retries > CONFIG.maxRetries) {
        console.error(`Producer ${producerId}: Max retries reached for batch ${batchNumber}`);
        throw error;
      }
      const backoffTime = exponentialBackoff(retries);
      console.log(`Producer ${producerId}: Retrying in ${backoffTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffTime));
    }
  }
};

const runProducer = async (producerId) => {
  const producer = createProducer();
  await producer.connect();

  let schemaId;
  try {
    const latestSchema = await registry.getLatestSchemaId("schema_a");
    schemaId = latestSchema;
  } catch (error) {
    console.error("Failed to fetch the latest schema ID:", error);
    return;
  }

  let batchNumber = 0;
  let eventsSent = 0;

  while (CONFIG.totalEvents === 0 || eventsSent < CONFIG.totalEvents / CONFIG.numberOfProducers) {
    try {
      const batchEventsSent = await produceMessages(producer, schemaId, batchNumber++, producerId);
      eventsSent += batchEventsSent;
      console.log(`Producer ${producerId}: Total events sent: ${eventsSent}`);
      
      if (CONFIG.totalEvents > 0 && eventsSent >= CONFIG.totalEvents / CONFIG.numberOfProducers) {
        console.log(`Producer ${producerId}: Reached events limit. Stopping.`);
        break;
      }
      
      await new Promise((resolve) => setTimeout(resolve, CONFIG.delayBetweenBatches));
    } catch (error) {
      console.error(`Producer ${producerId}: Fatal error:`, error);
      break;
    }
  }

  await producer.disconnect();
};

const run = async () => {
  for (let i = 0; i < CONFIG.numberOfProducers; i++) {
    setTimeout(() => {
      runProducer(i).catch(console.error);
    }, i * CONFIG.rampUpDelay);
  }
};

run().catch(console.error);