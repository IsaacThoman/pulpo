#include <algorithm>
#include <atomic>
#include <cassert>
#include <chrono>
#include <cstdint>
#include <iostream>
#include <list>
#include <mutex>
#include <string>
#include <thread>
#include <tuple>
#include <unordered_map>
#include <vector>
#include <sys/resource.h>

// Inspect the actual dependency's storage only in this standalone test binary.
// Include standard headers first so the access override cannot affect them.
#define private public
#include MEASUREMENT_CACHE_HEADER
#undef private

using namespace facebook::react;
#ifdef CACHE_PATCHED
constexpr size_t budget = 8 * 1024 * 1024;
#endif

MeasurementCacheKey keyFor(size_t id, size_t length = 128) {
  auto prefix = std::to_string(id) + ':';
  std::string markdown(std::max(length, prefix.size()), 'x');
  markdown.replace(0, prefix.size(), prefix);
  return MeasurementCacheKey{
      .markdown = markdown, .maxWidth = 320, .allowTrailingMargin = false,
      .allowFontScaling = true, .maxFontSizeMultiplier = 2,
      .md4cFlagsUnderline = false, .md4cFlagsSuperscript = false,
      .md4cFlagsSubscript = false, .md4cFlagsHighlight = false,
      .md4cFlagsLatexMath = true, .styleFingerprint = 1,
      .fontScale = 1, .flavor = MarkdownFlavor::GitHub,
  };
}

size_t retainedTextBytes(const MeasurementCache &cache) {
  size_t bytes = 0;
  for (const auto &entry : cache.list_) bytes += entry.key.markdown.size();
  for (const auto &entry : cache.map_) bytes += entry.first.markdown.size();
  return bytes;
}

void checkInvariants(const MeasurementCache &cache) {
  assert(cache.list_.size() == cache.map_.size());
  assert(cache.map_.size() <= 512);
  for (auto iterator = cache.list_.begin(); iterator != cache.list_.end(); ++iterator) {
    auto found = cache.map_.find(iterator->key);
    assert(found != cache.map_.end());
    assert(found->second == iterator);
  }
#ifdef CACHE_PATCHED
  assert(retainedTextBytes(cache) == cache.markdownBytes_);
  assert(cache.markdownBytes_ <= budget);
#endif
}

bool contains(MeasurementCache &cache, const MeasurementCacheKey &key) {
  CachedSize size{};
  return cache.get(key, size);
}

void runTests() {
  {
    MeasurementCache cache;
    CachedSize size{};
    assert(!cache.get(keyFor(1), size));
    for (size_t id = 0; id < 512; ++id) cache.set(keyFor(id), {double(id), 12});
    assert(contains(cache, keyFor(0))); // A hit promotes the oldest entry.
    cache.set(keyFor(512), {512, 12});
    assert(contains(cache, keyFor(0)));
    assert(!contains(cache, keyFor(1)));
    const auto bytes = retainedTextBytes(cache);
    cache.set(keyFor(2), {99, 100}); // Replacement updates size and recency.
    assert(retainedTextBytes(cache) == bytes);
    assert(cache.get(keyFor(2), size) && size.width == 99 && size.height == 100);
    cache.set(keyFor(513), {513, 12});
    assert(contains(cache, keyFor(2)));
    assert(!contains(cache, keyFor(3)));
    checkInvariants(cache);
  }
  {
    MeasurementCache cache;
    auto key = keyFor(1);
    auto differentWidth = key; differentWidth.maxWidth += 1;
    auto differentStyle = key; differentStyle.styleFingerprint += 1;
    auto differentFlavor = key; differentFlavor.flavor = MarkdownFlavor::CommonMark;
    cache.set(key, {1, 2}); cache.set(differentWidth, {3, 4});
    cache.set(differentStyle, {5, 6}); cache.set(differentFlavor, {7, 8});
    assert(cache.map_.size() == 4);
    CachedSize size{};
    assert(cache.get(differentWidth, size) && size.width == 3);
    assert(cache.get(differentStyle, size) && size.width == 5);
    assert(cache.get(differentFlavor, size) && size.width == 7);
    checkInvariants(cache);
  }
  {
    MeasurementCache cache;
    auto empty = keyFor(0); empty.markdown.clear();
    for (size_t id = 0; id < 513; ++id) { empty.maxWidth = double(id); cache.set(empty, {1, 2}); }
    assert(cache.map_.size() == 512);
    assert(retainedTextBytes(cache) == 0);
    checkInvariants(cache);
  }
#ifdef CACHE_PATCHED
  {
    MeasurementCache cache;
    for (size_t id = 0; id < 8; ++id) cache.set(keyFor(id, budget / 16), {double(id), 1});
    assert(retainedTextBytes(cache) == budget);
    // One large insertion needs three evictions, keeping the newest five.
    cache.set(keyFor(8, 3 * budget / 16), {8, 1});
    assert(cache.map_.size() == 6);
    for (size_t id = 0; id < 8; ++id) assert(contains(cache, keyFor(id, budget / 16)) == (id >= 3));
    assert(retainedTextBytes(cache) == budget);
    checkInvariants(cache);
  }
  {
    MeasurementCache cache;
    // UTF-8 bytes, not character count. Both copies exactly fill the budget.
    auto exact = keyFor(0); exact.markdown.clear();
    for (size_t index = 0; index < budget / 8; ++index) exact.markdown += "\xf0\x9f\xa6\x91";
    cache.set(exact, {1, 2});
    assert(retainedTextBytes(cache) == budget);
    auto oversized = exact; oversized.markdown += 'x';
    cache.set(oversized, {3, 4});
    assert(!contains(cache, oversized));
    assert(contains(cache, exact)); // Rejected keys leave useful entries intact.
    cache.set(exact, {5, 6});
    CachedSize size{};
    assert(cache.get(exact, size) && size.width == 5);
    checkInvariants(cache);
    cache.set(keyFor(2), {7, 8});
    assert(!contains(cache, exact));
    assert(retainedTextBytes(cache) == 256);
    checkInvariants(cache);
  }
#endif
  {
    MeasurementCache cache;
    std::vector<std::thread> threads;
    for (size_t thread = 0; thread < 4; ++thread) threads.emplace_back([&, thread] {
      for (size_t index = 0; index < 300; ++index) {
        const size_t id = (index + thread * 113) % 700;
        const auto key = keyFor(id, 16 * 1024);
        cache.set(key, {double(id), 12});
        CachedSize size{};
        if (cache.get(key, size)) assert(size.width == double(id) && size.height == 12);
      }
    });
    for (auto &thread : threads) thread.join();
    checkInvariants(cache);
  }
  std::cout << "{\"testsPassed\":true}" << std::endl;
}

void runBenchmark() {
  MeasurementCache cache;
  const auto started = std::chrono::steady_clock::now();
  constexpr size_t snapshots = 512;
  for (size_t index = 0; index < snapshots; ++index) {
    // Distinct prefixes from a single growing long response, like 100ms commits.
    MeasurementCacheKey key = keyFor(0, 256 * 1024 + index * 256);
    cache.set(key, {320, double(index)});
  }
  const auto finished = std::chrono::steady_clock::now();
  checkInvariants(cache);
  // Lookup-only historical-prefix probe: misses are not reinserted.
  size_t hits = 0;
  for (size_t index = 0; index < snapshots; ++index) {
    if (contains(cache, keyFor(0, 256 * 1024 + index * 256))) ++hits;
  }
  struct rusage usage{};
  assert(getrusage(RUSAGE_SELF, &usage) == 0);
#ifdef __APPLE__
  const auto peakRssBytes = usage.ru_maxrss;
#else
  const auto peakRssBytes = usage.ru_maxrss * 1024;
#endif
  const auto milliseconds = std::chrono::duration<double, std::milli>(finished - started).count();
  std::cout << "{\"snapshots\":" << snapshots
            << ",\"retainedEntries\":" << cache.map_.size()
            << ",\"retainedKeyTextBytes\":" << retainedTextBytes(cache)
            << ",\"peakRssBytes\":" << peakRssBytes
            << ",\"historicalCacheHits\":" << hits
            << ",\"insertMilliseconds\":" << milliseconds << "}" << std::endl;
}

int main(int argc, char **argv) {
  if (argc > 1 && std::string(argv[1]) == "benchmark") runBenchmark();
  else runTests();
}
