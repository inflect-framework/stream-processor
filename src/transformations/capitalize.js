module.exports = (message) => {
  return {
    key: message.key,
    value: message.value.toUpperCase(),
    num: message.num
  };
};