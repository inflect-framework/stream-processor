module.exports = (message) => {
  return {
    key: message.key,
    value: message.value + '_appended',
    num: message.num
  };
};