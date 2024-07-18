module.exports = (message) => {
  return {
    key: message.key,
    value: message.value,
    num: message.num + 10
  };
};