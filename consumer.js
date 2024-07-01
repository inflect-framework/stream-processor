const { Kafka } = require('kafkajs');
const { dotenv } = require('dotenv').config();
const APIKEY = process.env.APIKEY;
const APISECRET = process.env.APISECRET;
const BROKER = process.env.BROKER


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


const consumer = kafka.consumer({ groupId: 'my-group' });
const producer = kafka.producer();

const run = async (sourceTopic, targetTopic, transformationName) => {
  await consumer.connect();
  await producer.connect();
  await consumer.subscribe({ topic: sourceTopic, fromBeginning: true });


    // const res = await pool.query(query, [transformationName, targetTopic]);
    // return res.rows;

  const transformation = require(`./transformations/${transformationName}`)

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const key = message.key.toString();
      const value = message.value.toString();

      console.log(`Consumed message: ${key} - ${value}`);

      const transformedValue = transformation(message.value);

      await producer.send({
        topic: targetTopic,
        messages: [
          { key, value: transformedValue }
        ],
      });

      console.log(`Produced transformed message: ${key} - ${transformedValue}`);
    },
  });
};


// whenever http request comes in, process the request and call run with arguments 
// run().catch(console.error);

module.exports = run;