const pool = require('./db')

const checkConnectionsQuery = `
                      SELECT 
                      c.id,
                      c.active_state,
                      s.source_topic,
                      t.target_topic,
                      tr.transformation_name
                      FROM 
                      connections c
                      INNER JOIN 
                      sources s ON s.id = c.source_id
                      INNER JOIN 
                      targets t ON t.id = c.target_id
                      INNER JOIN 
                      transformations tr ON tr.id = c.transformation_id
                      WHERE 
                      s.source_topic = $1 AND
                      t.target_topic = $2 AND
                      tr.transformation_name = $3;
              `;

const insertConnectionQuery = `
    INSERT INTO connections (source_id, target_id, transformation_id, active_state)
    VALUES (
        (SELECT id FROM sources WHERE source_topic = $1),
        (SELECT id FROM targets WHERE target_topic = $2),
        (SELECT id FROM transformations WHERE transformation_name = $3),
        true
    )
    RETURNING *;
`;


const addTransformation = async (sourceTopic, targetTopic, transformationName) => {
  
  const connectionValues = [sourceTopic, targetTopic, transformationName];

  const result = await pool.query(checkConnectionsQuery, connectionValues)

  if (result.rowCount === 0) {
    await pool.query(insertConnectionQuery, connectionValues);
  }
}

module.exports = addTransformation