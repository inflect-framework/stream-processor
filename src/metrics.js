const promClient = require('prom-client');

const register = new promClient.Registry();

const messageProcessedCounter = new promClient.Counter({
  name: 'message_processed_total',
  help: 'Total number of messages processed',
  labelNames: ['pipeline_id', 'pod_name', 'status']
});
register.registerMetric(messageProcessedCounter);

const messageProcessingDuration = new promClient.Histogram({
  name: 'message_processing_duration_seconds',
  help: 'Duration of message processing in seconds',
  labelNames: ['pipeline_id', 'pod_name', 'step']
});
register.registerMetric(messageProcessingDuration);

promClient.collectDefaultMetrics({ register });

module.exports = {
  register,
  messageProcessedCounter,
  messageProcessingDuration
};