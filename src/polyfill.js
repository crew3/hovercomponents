const Stream = require('stream-browserify');
const Buffer = require('buffer');

// OR inject it into the module scope for modules that call `require('stream')`
global.require = (moduleName) => {
  if (moduleName === 'stream') {
    return Stream;
  }
  if (moduleName === 'buffer') {
    return Buffer;
  }
  return require(moduleName);  // For other modules, fall back to default behavior
};