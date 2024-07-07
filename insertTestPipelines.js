const { Client } = require('pg');
require('dotenv').config();

const pgClient = new Client({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: 'inflect',
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

async function insertTestData() {
  try {
    await pgClient.connect();

    const pipelines = [
      {
        name: 'pipeline_a',
        source_topic: 'source_a',
        target_topic: 'target_a',
        incoming_schema: 'schema_a',
        outgoing_schema: 'schema_a',
        steps: { processors: ['1'] },
        is_active: true,
      },
      {
        name: 'pipeline_b',
        source_topic: 'source_b',
        target_topic: 'target_b',
        incoming_schema: 'schema_b',
        outgoing_schema: 'schema_b',
        steps: { processors: ['1'] },
        is_active: true,
      },
      {
        name: 'pipeline_c',
        source_topic: 'source_c',
        target_topic: 'target_c',
        incoming_schema: 'schema_c',
        outgoing_schema: 'schema_c',
        steps: { processors: ['1'] },
        is_active: true,
      },
    ];

    for (const pipeline of pipelines) {
      const sourceTopicId = await getTopicId(pipeline.source_topic);
      const targetTopicId = await getTopicId(pipeline.target_topic);
      const incomingSchemaId = await getSchemaId(pipeline.incoming_schema);
      const outgoingSchemaId = await getSchemaId(pipeline.outgoing_schema);

      const query = `
        INSERT INTO pipelines (
          name, source_topic_id, target_topic_id, incoming_schema_id, outgoing_schema_id, steps, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (name) DO NOTHING;
      `;

      const values = [
        pipeline.name,
        sourceTopicId,
        targetTopicId,
        incomingSchemaId,
        outgoingSchemaId,
        pipeline.steps,
        pipeline.is_active,
      ];

      await pgClient.query(query, values);
    }

    console.log('Test data inserted successfully');
  } catch (error) {
    console.error('Error inserting test data:', error);
  } finally {
    await pgClient.end();
  }
}

async function getTopicId(topicName) {
  const res = await pgClient.query('SELECT id FROM topics WHERE topic_name = $1', [topicName]);
  if (res.rows.length === 0) {
    throw new Error(`Topic ${topicName} not found`);
  }
  return res.rows[0].id;
}

async function getSchemaId(schemaName) {
  const res = await pgClient.query('SELECT id FROM schemas WHERE schema_name = $1', [schemaName]);
  if (res.rows.length === 0) {
    throw new Error(`Schema ${schemaName} not found`);
  }
  return res.rows[0].id;
}

insertTestData();