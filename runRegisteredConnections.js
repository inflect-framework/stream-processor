const pool = require('./db')
const run = require('./consumer')

const connectionsQuery = `
SELECT 
    tr.transformation_name, 
    s.source_topic, 
    t.target_topic 
FROM 
    connections c
JOIN 
    sources s ON c.source_id = s.id
JOIN 
    targets t ON c.target_id = t.id
JOIN 
    transformations tr ON c.transformation_id = tr.id;

`

const runConnections = async () => {
  try {
    const connections = (await pool.query(connectionsQuery)).rows
    connections
      .forEach(row => {
        run(row.source_topic, row.target_topic, row.transformation_name)
      })   
  } catch (error) {
    console.error(error)
  }
}


module.exports = runConnections;