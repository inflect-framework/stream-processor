const { processingDuration, transformationSuccessRate } = require("../metrics");

module.exports = (message) => {
  const startTime = process.hrtime();

  try {
    const result = {
      key: message.key,
      value: message.value + "_appended",
      num: message.num,
    };

    transformationSuccessRate.labels(process.env.PIPELINE_ID, "add10").inc();
    return result;
  } finally {
    const [seconds, nanoseconds] = process.hrtime(startTime);
    processingDuration
      .labels(process.env.PIPELINE_ID, "add10")
      .observe(seconds + nanoseconds / 1e9);
  }
};