const { Kafka } = require('kafkajs');
const dotenv = require('dotenv').config();
const { SchemaRegistry, readAVSCAsync } = require('@kafkajs/confluent-schema-registry');

const APIKEY = process.env.APIKEY;
const APISECRET = process.env.APISECRET;
const BROKER = process.env.BROKER;
const REGISTRY_URL = process.env.REGISTRY_URL;
const REGISTRY_APIKEY = process.env.REGISTRY_APIKEY;
const REGISTRY_APISECRET = process.env.REGISTRY_APISECRET;

const kafka = new Kafka({
  clientId: 'my-producer',
  brokers: [BROKER],
  ssl: true,
  sasl: {
    mechanism: 'plain',
    username: APIKEY,
    password: APISECRET
  }
});

const producer = kafka.producer({
  allowAutoTopicCreation: true,
  idempotent: true,
  transactionalId: 'my-transactional-id',
});

const registry = new SchemaRegistry({ 
  host: REGISTRY_URL,
  auth: { 
    username: REGISTRY_APIKEY, 
    password: REGISTRY_APISECRET 
  } 
});

const run = async () => {
  await producer.connect();

  const schema = await readAVSCAsync('./schemas/sourceTopicSchema.avsc');
  const { id: schemaId } = await registry.register(schema);

  const produceMessages = async (batchNumber) => {
    const messages = [];
    for (let i = 0; i < 1000; i++) {
      const key = `key-${batchNumber}-${i}`;
      const value = `value-${batchNumber}-${i}`;
      const encodedValue = await registry.encode(schemaId, { key, value });
      
      if (encodedValue[0] !== 0) {
        throw new Error(`Invalid magic byte in encoded message: ${encodedValue[0]}`);
      }
      
      messages.push({ key: Buffer.from(key), value: encodedValue });
    }

    await producer.send({
      topic: 'source_topic',
      messages: messages,
    });

    console.log(`Produced batch ${batchNumber} with ${messages.length} messages`);
  };

  let batchNumber = 0;
  while (true) {
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(produceMessages(batchNumber++));
    }
    await Promise.all(promises);
  }
};

run().catch(console.error);