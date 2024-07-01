const { Kafka } = require('kafkajs');
const { dotenv } = require('dotenv').config();
const APIKEY = process.env.APIKEY;
const APISECRET = process.env.APISECRET;
const BROKER = process.env.BROKER

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

const producer = kafka.producer();

const run = async () => {
  await producer.connect();
  
  for (let i = 0; i < 10; i++) {
    const key = `key-${i}`;
    const value = `value-${i}`;
    
    await producer.send({
      topic: 'source_topic',
      messages: [
        { key, value }
      ],
    });
    
    console.log(`Produced message: ${key} - ${value}`);
  }

  await producer.disconnect();
};

run().catch(console.error);