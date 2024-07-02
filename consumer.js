const { Kafka } = require('kafkajs');
const dotenv = require('dotenv').config();
const APIKEY = process.env.APIKEY;
const APISECRET = process.env.APISECRET;
const BROKER = process.env.BROKER;

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

const processBatch = async (messages, transformation, targetTopic) => {
  const transformedMessages = messages.map(({ key, value }) => {
    const transformedValue = transformation(value);
    return { key, value: transformedValue };
  });

  await producer.send({
    topic: targetTopic,
    messages: transformedMessages,
  });

  console.log(`Produced ${transformedMessages.length} transformed messages`);
};

const run = async (sourceTopic, targetTopic, transformationName) => {
  await consumer.connect();
  await producer.connect();
  await consumer.subscribe({ topic: sourceTopic, fromBeginning: true });

  const transformation = require(`./transformations/${transformationName}`);

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
          value: message.value.toString(),
        });

        if (messages.length >= batchSize) {
          const task = processBatch(messages, transformation, targetTopic);
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
        const task = processBatch(messages, transformation, targetTopic);
        await task;
        messages = [];
      }

      await commitOffsetsIfNecessary();
    },
  });

  console.log('Consumer is running');
};

module.exports = run;