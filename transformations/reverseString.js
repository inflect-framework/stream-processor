module.exports = (message) => {
  return {
    key: message.key,
    value: message.value.split('').reverse().join(''),
    num: message.num
  };
};