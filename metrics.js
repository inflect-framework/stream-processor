const express = require("express");
const client = require("prom-client");

const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ timeout: 5000 });

const messageCounter = new client.Counter({
  name: "messages_processed_total",
  help: "Total number of processed messages",
  labelNames: ["pipeline", "topic", "result"],
});

const processingDuration = new client.Histogram({
  name: "message_processing_duration_seconds",
  help: "Duration of message processing in seconds",
  labelNames: ["pipeline", "transformation"],
});

const kafkaConsumerLag = new client.Gauge({
  name: "kafka_consumer_lag",
  help: "Kafka consumer lag in messages",
  labelNames: ["pipeline", "topic", "partition"],
});

const transformationSuccessRate = new client.Counter({
  name: "transformation_success_rate",
  help: "Success rate of each transformation step",
  labelNames: ["pipeline", "transformation"],
});

const dlqMessagesTotal = new client.Counter({
  name: "dlq_messages_total",
  help: "Total number of messages sent to DLQ",
  labelNames: ["pipeline", "topic"],
});

const app = express();

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

app.listen(3000, () => {
  console.log("Metrics server listening on port 3000");
});

module.exports = {
  messageCounter,
  processingDuration,
  kafkaConsumerLag,
  transformationSuccessRate,
  dlqMessagesTotal,
};
