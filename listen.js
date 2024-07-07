const db = require('./db');
const consumeMessages = require('./consumer');

async function main() {
  const client = await db.getClient();

  client.on('notification', async (data) => {
    const payload = JSON.parse(data.payload);
    console.log('Received payload:', payload);
    await handlePipeline(payload);
  });

  await client.query('LISTEN pipeline_event');
  console.log('Listening for pipeline events');

  await runExistingPipelines();
}

async function runExistingPipelines() {
  const pipelinesQuery = 'SELECT * FROM pipelines WHERE is_active = true';
  const pipelinesResult = await db.query(pipelinesQuery);

  for (const row of pipelinesResult.rows) {
    await handlePipeline(row);
  }
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
    return;
  }

  const sourceTopic = sourceTopicResult.rows[0].topic_name;
  const targetTopic = targetTopicResult.rows[0].topic_name;
  const incomingSchema = incomingSchemaResult.rows[0].schema_name;
  const outgoingSchema = outgoingSchemaResult.rows[0].schema_name;

  console.log('Handling pipeline for:', { name, sourceTopic, targetTopic, incomingSchema, outgoingSchema, steps });
  await consumeMessages(sourceTopic, targetTopic, steps.processors, incomingSchema, outgoingSchema);
  console.log('Pipeline started for', { name, sourceTopic, targetTopic, incomingSchema, outgoingSchema, steps });
}

const shutdown = async () => {
  console.log('Listener shutdown initiated');
  try {
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown', error);
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main().catch(err => console.error('Error in main function', err));