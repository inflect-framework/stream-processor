const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

const pgClient = new Client({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: 'inflect',
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

const transformationsDir = path.join(__dirname, '..', '..', 'src', 'transformations');
const filtersDir = path.join(__dirname, '..', '..', 'src', 'filters');

const insertProcessor = async (processorName, isFilter) => {
  const query = `
    INSERT INTO processors (processor_name, is_filter) 
    VALUES ($1, $2) 
    ON CONFLICT (processor_name) DO UPDATE
    SET is_filter = $2
    WHERE processors.is_filter != $2;
  `;
  const values = [processorName, isFilter];
  await pgClient.query(query, values);
};

const processDirectory = async (directory, isFilter) => {
  const files = fs.readdirSync(directory);
  const jsFiles = files.filter(file => file.endsWith('.js'));
  const processorNames = jsFiles.map(file => path.basename(file, '.js'));

  for (const processorName of processorNames) {
    await insertProcessor(processorName, isFilter);
    console.log(`Processed ${isFilter ? 'filter' : 'transformation'}: ${processorName}`);
  }

  return processorNames;
};

const removeObsoleteProcessors = async (existingProcessors) => {
  const query = `
    DELETE FROM processors
    WHERE processor_name NOT IN (${existingProcessors.map((_, i) => `$${i + 1}`).join(', ')})
    RETURNING processor_name;
  `;
  const result = await pgClient.query(query, existingProcessors);
  for (const row of result.rows) {
    console.log(`Removed obsolete processor: ${row.processor_name}`);
  }
};

const main = async () => {
  try {
    await pgClient.connect();
    
    const transformations = await processDirectory(transformationsDir, false);
    const filters = await processDirectory(filtersDir, true);
    
    const allProcessors = [...transformations, ...filters];
    await removeObsoleteProcessors(allProcessors);

    console.log('Processors synchronized successfully');
  } catch (error) {
    console.error('Error processing processors:', error);
  } finally {
    await pgClient.end();
  }
};

main().catch(console.error);