const { Kafka } = require('kafkajs');
const dotenv = require('dotenv').config();
const APIKEY = process.env.APIKEY;
const APISECRET = process.env.APISECRET;
const BROKER = process.env.BROKER;

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

const BATCH_SIZE = 100;
const PARALLEL_BATCHES = 5;

const run = async () => {
  await producer.connect();
  
  const produceMessages = async (batchNumber) => {
    const messages = [];
    for (let i = 0; i < BATCH_SIZE; i++) {
      const key = `key-${batchNumber}-${i}`;
      const value = `value-${batchNumber}-${i}`;
      messages.push({ key, value });
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
    for (let i = 0; i < PARALLEL_BATCHES; i++) {
      promises.push(produceMessages(batchNumber++));
    }
    await Promise.all(promises);
  }

  // await producer.disconnect();
};

run().catch(console.error);