const express = require('express');
const cors = require('cors')
const consumer = require('./consumer')
const bodyParser = require('body-parser')
const addTransformation = require('./addTransformation')

const app = express();
app.use(cors());
app.use(bodyParser.json())


app.post('/createTransformation', (req, res) => {
  const {sourceTopic, targetTopic, transformation} = req.body;
  addTransformation(sourceTopic, targetTopic, transformation)
  consumer(sourceTopic, targetTopic, transformation);
  res.send(200, {message: 'Transformation created'});
})

app.listen(4000, () => {
  console.log('Stream processor app listening on port 4000')
})