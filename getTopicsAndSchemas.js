const { Kafka } = require('kafkajs');
const axios = require('axios');
require('dotenv').config();

const kafka = new Kafka({
  clientId: 'inflect-client',
  brokers: [process.env.BROKER],
  ssl: true,
  sasl: {
    mechanism: 'plain',
    username: process.env.APIKEY,
    password: process.env.APISECRET,
  },
});

const registryUrl = process.env.REGISTRY_URL;
const registryAuth = {
  username: process.env.REGISTRY_APIKEY,
  password: process.env.REGISTRY_APISECRET,
};

async function getTopicsAndSchemas() {
  try {
    const admin = kafka.admin();
    await admin.connect();
    const topics = await admin.listTopics();
    console.log('Kafka Topics:', topics);
    await admin.disconnect();

    const subjectsResponse = await axios.get(`${registryUrl}/subjects`, {
      auth: registryAuth
    });
    const subjects = subjectsResponse.data;
    console.log('Schema Registry Subjects:', subjects);

    const schemas = await Promise.all(subjects.map(async (subject) => {
      const schemaResponse = await axios.get(`${registryUrl}/subjects/${subject}/versions/latest`, {
        auth: registryAuth
      });
      return { subject, schema: schemaResponse.data.schema };
    }));
    console.log('Schemas:', schemas);
  } catch (error) {
    console.error('Error listing topics and schemas:', error);
  }
}

getTopicsAndSchemas();