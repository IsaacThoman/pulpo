const { imageSizeFromFile } = require('image-size-patched/fromFile')

// appdmg 0.6 uses the callback API removed in image-size 2. Keep that caller
// compatible while using the patched parser instead of its vulnerable 0.7 copy.
module.exports = function sizeOf(filename, callback) {
  imageSizeFromFile(filename).then(
    (dimensions) => callback(null, dimensions),
    (error) => callback(error),
  )
}
