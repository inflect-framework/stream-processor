const db = require('./db');
const consumer = require('./consumer');

async function main() {
  const client = await db.getClient();

  client.on('notification', async (data) => {
    const payload = JSON.parse(data.payload);
    console.log('Received payload:', payload);
    await handleConnection(payload);
  });

  await client.query('LISTEN connection_event');
  console.log('Listening for connection events');

  await runExistingConnections();
}

async function runExistingConnections() {
  const connectionsQuery = 'SELECT source_id, target_id, transformation_id FROM connections';
  const connectionsResult = await db.query(connectionsQuery);

  for (const row of connectionsResult.rows) {
    await handleConnection(row);
  }
}


async function handleConnection(payload) {
  const { source_id, target_id, transformation_id } = payload;

  const sourceQuery = 'SELECT source_topic FROM sources WHERE id = $1';
  const targetQuery = 'SELECT target_topic FROM targets WHERE id = $1';
  const transformationQuery = 'SELECT transformation_name FROM transformations WHERE id = $1';

  const sourceResult = await db.query(sourceQuery, [source_id]);
  const targetResult = await db.query(targetQuery, [target_id]);
  const transformationResult = await db.query(transformationQuery, [transformation_id]);

  if (sourceResult.rowCount === 0 || targetResult.rowCount === 0 || transformationResult.rowCount === 0) {
    console.error('Error: One or more required values are missing from the sources, targets, or transformations tables.');
    return;
  }

  const sourceTopic = sourceResult.rows[0].source_topic;
  const targetTopic = targetResult.rows[0].target_topic;
  const transformation = transformationResult.rows[0].transformation_name;

  console.log('Handling connection for:', { sourceTopic, targetTopic, transformation });
  await consumer(sourceTopic, targetTopic, transformation);
  console.log('Connection started for', { sourceTopic, targetTopic, transformation });
}

main().catch(err => console.error('Error in main function', err));