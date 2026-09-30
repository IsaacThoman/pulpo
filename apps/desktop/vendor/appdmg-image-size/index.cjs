const { imageSizeFromFile } = require('image-size-patched/fromFile')

// appdmg 0.6.6 only uses image-size's removed (path, callback) API to read
// background dimensions. Keep that contract while using the patched parser.
// This adapter retains a 0.7.x API version so npm can deduplicate appdmg's
// legacy range to the local package; the parser itself is image-size 2.0.4.
module.exports = function sizeOf(path, callback) {
  imageSizeFromFile(path).then(
    (size) => callback(null, size),
    (error) => callback(error),
  )
}
