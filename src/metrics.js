const promClient = require('prom-client');

const register = new promClient.Registry();

const messagesReceivedCounter = new promClient.Counter({
  name: 'messages_received_total',
  help: 'Total number of messages received',
  labelNames: ['pipeline_id', 'pod_name']
});
register.registerMetric(messagesReceivedCounter);

const processorsAppliedCounter = new promClient.Counter({
  name: 'processors_applied_total',
  help: 'Total number of times processors were applied to messages',
  labelNames: ['pipeline_id', 'pod_name', 'processor_name']
});
register.registerMetric(processorsAppliedCounter);

const messagesCompletedCounter = new promClient.Counter({
  name: 'messages_completed_total',
  help: 'Total number of messages that completed processing',
  labelNames: ['pipeline_id', 'pod_name']
});
register.registerMetric(messagesCompletedCounter);

const messagesErrorCounter = new promClient.Counter({
  name: 'messages_error_total',
  help: 'Total number of messages that resulted in an error',
  labelNames: ['pipeline_id', 'pod_name']
});
register.registerMetric(messagesErrorCounter);

const messagesDlqCounter = new promClient.Counter({
  name: 'messages_dlq_total',
  help: 'Total number of messages sent to DLQ',
  labelNames: ['pipeline_id', 'pod_name']
});
register.registerMetric(messagesDlqCounter);

const messagesDroppedCounter = new promClient.Counter({
  name: 'messages_dropped_total',
  help: 'Total number of messages dropped',
  labelNames: ['pipeline_id', 'pod_name']
});
register.registerMetric(messagesDroppedCounter);

const messageProcessingDuration = new promClient.Histogram({
  name: 'message_processing_duration_seconds',
  help: 'Duration of message processing in seconds',
  labelNames: ['pipeline_id', 'pod_name', 'step']
});
register.registerMetric(messageProcessingDuration);

promClient.collectDefaultMetrics({ register });

module.exports = {
  register,
  messagesReceivedCounter,
  processorsAppliedCounter,
  messagesCompletedCounter,
  messagesErrorCounter,
  messagesDlqCounter,
  messagesDroppedCounter,
  messageProcessingDuration
};