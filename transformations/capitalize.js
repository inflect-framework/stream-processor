const capitalize = (value) => {
  if (typeof value !== 'string') {
    value = String(value);
  }
  return value.toUpperCase();
}

module.exports = capitalize;