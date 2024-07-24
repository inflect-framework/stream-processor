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

const transformationsDir = path.join(__dirname, 'transformations');

const insertProcessor = async (processorName) => {
  const query = `
    INSERT INTO processors (processor_name, is_filter) 
    VALUES ($1, $2) 
    ON CONFLICT (processor_name) DO NOTHING;
  `;
  const values = [processorName, false];
  await pgClient.query(query, values);
};

const main = async () => {
  try {
    await pgClient.connect();
    
    const files = fs.readdirSync(transformationsDir);
    const jsFiles = files.filter(file => file.endsWith('.js'));

    for (const file of jsFiles) {
      const processorName = path.basename(file, '.js');
      await insertProcessor(processorName);
      console.log(`Inserted processor: ${processorName}`);
    }

    console.log('Processors inserted successfully');
  } catch (error) {
    console.error('Error inserting processors:', error);
  } finally {
    await pgClient.end();
  }
};

main().catch(console.error);