const { Kafka } = require("kafkajs");
const dotenv = require("dotenv").config();
const {
  SchemaRegistry,
  SchemaType,
} = require("@kafkajs/confluent-schema-registry");
const { messageCounter } = require("../metrics");

const APIKEY = process.env.APIKEY;
const APISECRET = process.env.APISECRET;
const BROKER = process.env.BROKER;
const REGISTRY_URL = process.env.REGISTRY_URL;
const REGISTRY_APIKEY = process.env.REGISTRY_APIKEY;
const REGISTRY_APISECRET = process.env.REGISTRY_APISECRET;

const kafka = new Kafka({
  clientId: "protobuf-producer",
  brokers: [BROKER],
  ssl: true,
  sasl: {
    mechanism: "plain",
    username: APIKEY,
    password: APISECRET,
  },
});

const producer = kafka.producer();

const registry = new SchemaRegistry({
  host: REGISTRY_URL,
  auth: {
    username: REGISTRY_APIKEY,
    password: REGISTRY_APISECRET,
  },
});

const protobufSchema = `
syntax = "proto3";
package inflect.streamprocessor;

message SchemaC1 {
  string key = 1;
  string value = 2;
  int32 num = 3;
}
`;

const run = async () => {
  await producer.connect();

  let schemaId;
  try {
    const { id } = await registry.register(
      { type: SchemaType.PROTOBUF, schema: protobufSchema },
      { subject: "schema_c" }
    );
    schemaId = id;
  } catch (error) {
    console.error("Failed to register and fetch schema ID:", error);
    return;
  }

  const produceMessages = async (batchNumber) => {
    const messages = [];
    for (let i = 0; i < 10; i++) {
      const key = `key-${batchNumber}-${i}`;
      const value = `value-${batchNumber}-${i}`;
      const num = batchNumber * 100 + i;
      const message = { key, value, num };
      const encodedValue = await registry.encode(schemaId, message);

      messages.push({ key: Buffer.from(key), value: encodedValue });
    }

    await producer.send({
      topic: "source_c",
      messages: messages,
    });
    messageCounter
      .labels("producer", "source_c", "produced")
      .inc(messages.length);
    console.log(
      `Produced batch ${batchNumber} with ${messages.length} messages`
    );

    console.log(
      `Produced batch ${batchNumber} with ${messages.length} messages`
    );
  };

  let batchNumber = 0;
  while (true) {
    await produceMessages(batchNumber++);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
};

run().catch(console.error);
