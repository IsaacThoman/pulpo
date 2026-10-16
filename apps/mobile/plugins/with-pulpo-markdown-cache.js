const { withDangerousMod } = require('expo/config-plugins');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const HEADER = 'ios/internals/MeasurementCache.h';
// react-native-enriched-markdown 0.7.4. Guard the whole header, including its key
// representation: the byte accounting assumes two owning markdown strings.
const UPSTREAM_SHA256 = '1bdc8a0384032d9db924214e9a02ac68df968880dbf2a758479b7d2c8cdaa07b';
const ORIGINAL_SET = `  void set(const MeasurementCacheKey &key, CachedSize size)
  {
    std::lock_guard<std::mutex> lock(mutex_);

    auto it = map_.find(key);
    if (it != map_.end()) {
      it->second->size = size;
      list_.splice(list_.begin(), list_, it->second);
      return;
    }

    list_.push_front({key, size});
    map_[key] = list_.begin();

    if (map_.size() > kMaxEntries) {
      auto &lastEntry = list_.back();
      map_.erase(lastEntry.key);
      list_.pop_back();
    }
  }`;
const PATCHED_SET = `  void set(const MeasurementCacheKey &key, CachedSize size)
  {
    // Pulpo: bound both retained UTF-8 markdown copies (list and map key).
    // Oversized entries must not evict useful measurements or overflow size_t.
    if (key.markdown.size() > kMaxMarkdownBytes / 2) {
      return;
    }
    const size_t keyBytes = key.markdown.size() * 2;
    std::lock_guard<std::mutex> lock(mutex_);

    auto it = map_.find(key);
    if (it != map_.end()) {
      it->second->size = size;
      list_.splice(list_.begin(), list_, it->second);
      return;
    }

    while (!list_.empty() && (map_.size() >= kMaxEntries || keyBytes > kMaxMarkdownBytes - markdownBytes_)) {
      auto &lastEntry = list_.back();
      markdownBytes_ -= lastEntry.key.markdown.size() * 2;
      map_.erase(lastEntry.key);
      list_.pop_back();
    }

    list_.push_front({key, size});
    map_[key] = list_.begin();
    markdownBytes_ += keyBytes;
  }`;
const ORIGINAL_FIELDS = '  static constexpr size_t kMaxEntries = 512;\n  mutable std::mutex mutex_;';
const PATCHED_FIELDS = `  static constexpr size_t kMaxEntries = 512;
  // Retained key text only: excludes allocator overhead, views and layout data.
  static constexpr size_t kMaxMarkdownBytes = 8 * 1024 * 1024;
  size_t markdownBytes_ = 0;
  mutable std::mutex mutex_;`;

const digest = (source) => createHash('sha256').update(source).digest('hex');
function originalMeasurementCacheSource(source) {
  const original = source.replace(PATCHED_SET, ORIGINAL_SET).replace(PATCHED_FIELDS, ORIGINAL_FIELDS);
  if (digest(original) !== UPSTREAM_SHA256) {
    // node_modules keeps an earlier plugin version's patch until the package is reinstalled;
    // `npm install` does not restore modified files, so say how to recover.
    const stalePatch = original.includes('// Pulpo:') || original.includes('kMaxMarkdownBytes');
    throw new Error(stalePatch
      ? `react-native-enriched-markdown's ${HEADER} contains a different Pulpo patch; reinstall react-native-enriched-markdown (for example \`npm ci\`) to restore the upstream header, or update withPulpoMarkdownCache and its native tests before prebuilding.`
      : `react-native-enriched-markdown's ${HEADER} changed; update withPulpoMarkdownCache and its native tests before prebuilding.`);
  }
  return original;
}

function patchMeasurementCache(source) {
  const original = originalMeasurementCacheSource(source);
  return original.replace(ORIGINAL_SET, PATCHED_SET).replace(ORIGINAL_FIELDS, PATCHED_FIELDS);
}

module.exports = function withPulpoMarkdownCache(config) {
  return withDangerousMod(config, ['ios', async (config) => {
    const root = path.dirname(require.resolve('react-native-enriched-markdown/package.json', { paths: [config.modRequest.projectRoot] }));
    const filename = path.join(root, HEADER);
    const source = await fs.readFile(filename, 'utf8');
    const patched = patchMeasurementCache(source);
    if (patched !== source) await fs.writeFile(filename, patched);
    return config;
  }]);
};
module.exports.patchMeasurementCache = patchMeasurementCache;
module.exports.originalMeasurementCacheSource = originalMeasurementCacheSource;
module.exports.HEADER = HEADER;
module.exports.UPSTREAM_SHA256 = UPSTREAM_SHA256;
