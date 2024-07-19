const { Kafka } = require("kafkajs");
const axios = require("axios");
require("dotenv").config();
const { Client } = require("pg");

const kafka = new Kafka({
  clientId: "inflect-client",
  brokers: [process.env.BROKER],
  ssl: true,
  sasl: {
    mechanism: "plain",
    username: process.env.APIKEY,
    password: process.env.APISECRET,
  },
});

const registryUrl = process.env.REGISTRY_URL;
const registryAuth = {
  username: process.env.REGISTRY_APIKEY,
  password: process.env.REGISTRY_APISECRET,
};

const pgClient = new Client({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: "inflect",
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

const insertTopic = async (topicName) => {
  const query = `
    INSERT INTO topics (topic_name)
    VALUES ($1)
    ON CONFLICT (topic_name) DO NOTHING;
  `;
  await pgClient.query(query, [topicName]);
};

const insertSchema = async (schemaName) => {
  const query = `
    INSERT INTO schemas (schema_name)
    VALUES ($1)
    ON CONFLICT (schema_name) DO NOTHING;
  `;
  await pgClient.query(query, [schemaName]);
};

async function getAndInsertTopicsAndSchemas() {
  try {
    await pgClient.connect();

    const admin = kafka.admin();
    await admin.connect();
    const topics = await admin.listTopics();
    await admin.disconnect();

    for (const topic of topics) {
      await insertTopic(topic);
    }
    console.log("Kafka Topics:", topics);

    const subjectsResponse = await axios.get(`${registryUrl}/subjects`, {
      auth: registryAuth,
    });
    const subjects = subjectsResponse.data;

    for (const subject of subjects) {
      await insertSchema(subject);
    }
    console.log("Schema Registry Subjects:", subjects);

    console.log("Topics and schemas inserted successfully");
  } catch (error) {
    console.error("Error listing topics and schemas:", error);
  } finally {
    await pgClient.end();
  }
}

getAndInsertTopicsAndSchemas();
