const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pgClient = new Client({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: 'inflect',
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

const transformationsDir = path.join(__dirname, 'transformations');

const getRandomTransformations = async (allTransformations, min, max) => {
  const count = Math.floor(Math.random() * (max - min + 1)) + min;
  const shuffled = allTransformations.sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, count);
  
  const processorIds = [];
  for (const name of selected) {
    const result = await pgClient.query('SELECT id FROM processors WHERE processor_name = $1', [name]);
    if (result.rows.length === 0) {
      throw new Error(`Processor ${name} not found`);
    }
    processorIds.push(result.rows[0].id);
  }

  return processorIds;
};

async function updatePipelines() {
  try {
    await pgClient.connect();

    const files = fs.readdirSync(transformationsDir);
    const transformationNames = files
      .filter(file => file.endsWith('.js'))
      .map(file => path.basename(file, '.js'));

    const pipelinesResult = await pgClient.query('SELECT * FROM pipelines');
    const pipelines = pipelinesResult.rows;

    for (const pipeline of pipelines) {
      const randomTransformations = await getRandomTransformations(transformationNames, 2, 4);

      const updateQuery = `
        UPDATE pipelines
        SET steps = $1
        WHERE id = $2;
      `;

      const values = [
        { processors: randomTransformations },
        pipeline.id,
      ];

      await pgClient.query(updateQuery, values);
    }

    console.log('Pipelines updated successfully');
  } catch (error) {
    console.error('Error updating pipelines:', error);
  } finally {
    await pgClient.end();
  }
}

updatePipelines();