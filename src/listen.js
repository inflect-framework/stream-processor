const db = require('./db');
const runConsumer = require('./consumer');
const http = require('http');
const { register } = require('./metrics');

const PIPELINE_ID = process.env.PIPELINE_ID;

const server = http.createServer(async (req, res) => {
  if (req.url === '/metrics') {
    res.setHeader('Content-Type', register.contentType);
    res.end(await register.metrics());
  } else {
    res.statusCode = 404;
    res.end('Not Found');
  }
});

server.listen(3000, () => {
  console.log('Metrics server is running on port 3000');
});

async function main() {
  if (!PIPELINE_ID) {
    console.error('PIPELINE_ID environment variable is not set. Exiting.');
    process.exit(1);
  }

  await handleSpecificPipeline(PIPELINE_ID);
}

async function handleSpecificPipeline(pipelineId) {
  const pipelineQuery = 'SELECT * FROM pipelines WHERE id = $1 AND is_active = true';
  const pipelineResult = await db.query(pipelineQuery, [pipelineId]);

  if (pipelineResult.rowCount === 0) {
    console.error(`No active pipeline found with id ${pipelineId}`);
    process.exit(1);
  }

  await handlePipeline(pipelineResult.rows[0]);
}

async function handlePipeline(payload) {
  const { name, source_topic_id, target_topic_id, incoming_schema_id, outgoing_schema_id, steps, is_active } = payload;

  const topicQuery = 'SELECT topic_name FROM topics WHERE id = $1';
  const schemaQuery = 'SELECT schema_name FROM schemas WHERE id = $1';

  const sourceTopicResult = await db.query(topicQuery, [source_topic_id]);
  const targetTopicResult = await db.query(topicQuery, [target_topic_id]);
  const incomingSchemaResult = await db.query(schemaQuery, [incoming_schema_id]);
  const outgoingSchemaResult = await db.query(schemaQuery, [outgoing_schema_id]);

  if (
    sourceTopicResult.rowCount === 0 ||
    targetTopicResult.rowCount === 0 ||
    incomingSchemaResult.rowCount === 0 ||
    outgoingSchemaResult.rowCount === 0
  ) {
    console.error('Error: One or more required values are missing from the topics or schemas tables.');
    process.exit(1);
  }

  const sourceTopic = sourceTopicResult.rows[0].topic_name;
  const targetTopic = targetTopicResult.rows[0].topic_name;
  const incomingSchema = incomingSchemaResult.rows[0].schema_name;
  const outgoingSchema = outgoingSchemaResult.rows[0].schema_name;

  console.log('Handling pipeline for:', { name, sourceTopic, targetTopic, incomingSchema, outgoingSchema, steps });
  await runConsumer(sourceTopic, targetTopic, steps, incomingSchema, outgoingSchema);
  console.log('Pipeline started for', { name, sourceTopic, targetTopic, incomingSchema, outgoingSchema, steps });
}

const shutdown = async () => {
  console.log('Listener shutdown initiated');
  try {
    await db.end();
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  } catch (error) {
    console.error('Error during shutdown', error);
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main().catch(err => {
  console.error('Error in main function', err);
  process.exit(1);
});