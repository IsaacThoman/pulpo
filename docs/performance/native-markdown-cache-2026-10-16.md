# Bound iOS native Markdown measurement cache text

The iOS Markdown renderer retains complete message strings in its global
measurement cache. Its 512-entry limit does not bound retained bytes: different
streaming prefixes are distinct entries, and each entry owns two copies of its
UTF-8 source, in the LRU list and the hash-map key. The cache outlives mounted
messages and Pulpo's JavaScript transcript residency manager.

This audit found the behavior in `react-native-enriched-markdown` 0.7.4's
`ios/internals/MeasurementCache.h`. `ShadowMeasurementUtils.h` uses the cache
when `streamingAnimation` is false, which Pulpo explicitly sets in
`apps/mobile/src/components/SafeMarkdown.tsx`. The native renderer still needs
accurate layout during streaming; changing the animation flag would also change
layout behavior and is outside this fix.

## Change

`apps/mobile/plugins/with-pulpo-markdown-cache.js` patches the dependency's iOS
header during Expo prebuild. The cache retains its 512-entry limit and existing
mutex, keys, measured sizes, and LRU promotion. It additionally caps retained
duplicated Markdown key text at 8 MiB:

- Account for both owning source-string copies using UTF-8 byte length.
- Bypass a source larger than 4 MiB without evicting useful entries. Check the
  limit before multiplying its size, avoiding integer overflow.
- Promote and update an existing key without changing its byte accounting.
- Evict as many oldest entries as needed before inserting a new key, satisfying
  both count and text-byte limits.

The patch validates the complete upstream header's SHA-256, including the key
representation. Reapplying it validates and preserves the exact patched source.
Upstream drift, including an altered patched budget, stops prebuild with a clear
instruction to update the plugin and native tests. This follows Pulpo's existing
prebuild dependency-patching approach; `node_modules` changes are generated
artifacts rather than checked-in source.

The 8 MiB limit bounds **retained key text**, not total native allocations. It
excludes string capacity/terminators, cache nodes, hash-table capacity, temporary
measurement keys, parsed Markdown, attributed strings, images, and views. It is
not an application RSS limit or evidence that previously observed whole-app
memory growth has been eliminated.

## Before/after evidence

The [raw report](native-markdown-cache-2026-10-16.json) was collected on an Apple
M5 Pro / arm64 host, Darwin 27.0.0, Apple Clang 21.0.0, optimized C++20. The
driver compiles the **actual original and patched dependency headers** with
minimal platform include stubs. It does not implement a substitute cache.

Each sample starts a fresh process and inserts 512 progressively longer prefixes
of one synthetic answer, starting at 256 KiB and growing by 256 bytes per
snapshot to just below 384 KiB. Width/style/font/flavor remain constant. The
original and patched sample order alternates; seven samples were recorded after
compilation and correctness tests finished, without concurrent builds or other
benchmark runs.

| Metric | Original | Patched |
| --- | ---: | ---: |
| Retained entries after 512 prefixes | 512 | 10 |
| Retained duplicated UTF-8 key text | 335,413,248 bytes | 7,836,160 bytes |
| Standalone process peak RSS, median | 350,732,288 bytes | 14,286,848 bytes |
| Insert 512 prefixes, median | 37.37 ms | 31.48 ms |
| Lookup-only historical-prefix hits | 512 / 512 | 10 / 512 |

Retained source text decreased by 97.7% in this deliberately large-answer
fixture. The RSS measurements belong to these standalone C++ processes; they
exclude the React Native renderer, parsing, native layout, and actual app
navigation. Insertion time is a diagnostic, not an end-to-end rendering result.

The historical probe only calls lookup; it does not reinsert misses or model a
read-through revisit workload. The lower historical hit count exposes the tradeoff: evicted sizes must be
measured again when revisited. Small documents can still reach the 512-entry
limit; sufficiently large documents reach the byte limit sooner. This benchmark
does not claim a production cache hit rate or quantify the additional layout
cost when reopening many large messages.

## Validation and reproduction

The native driver verifies list/map invariants, the entry cap, LRU hit promotion,
replacement size/recency, distinct width/style/flavor keys, zero-length keys,
exact 8 MiB capacity, UTF-8 accounting, oversized-key bypass, multiple eviction,
and four concurrent readers/writers. The patched tests also compare the tracked
byte count with the strings actually retained in both containers.

```sh
# Installed workspace dependencies, Node, and a C++20 compiler are required.
node scripts/benchmarks/native-markdown-cache.mjs --test-only
BENCH_OUTPUT=/tmp/pulpo-native-markdown-cache.json node scripts/benchmarks/native-markdown-cache.mjs

# Optional race detector; run separately from timing measurements.
BENCH_TSAN=1 node scripts/benchmarks/native-markdown-cache.mjs --test-only
```

`CXX` selects the compiler; `BENCH_SAMPLES` changes the default seven samples.
Temporary headers, platform stubs, and executables are removed afterward. The
driver accepts both an original and an already-patched installed header, checking
its identity before reconstructing the original baseline.

The plugin's Vitest cases separately verify actual installed-source
compatibility, idempotence, and rejection of upstream/patch drift. A native app
rebuild is required to consume the changed header; replacing only JavaScript in
an existing simulator shell cannot validate integration of this native change.

The two plugin Vitest cases passed. Original and patched native-header tests also
passed with ThreadSanitizer enabled, including the concurrent readers/writers;
no races were reported by that run. Native app integration is validated
separately from the standalone cache measurements above.


### Fresh native integration, October 16

A fresh Expo iOS prebuild applied the patch, CocoaPods installed successfully,
and Xcode built the normal app in **Release** for the iOS Simulator with code
signing disabled. That freshly built app installed and launched successfully on
a disposable iPhone 18 Pro simulator running iOS 27.0. This validates compilation
and startup of the actual patched native header, rather than a JavaScript-only
replacement in an older shell.

A temporary copy of that same binary then ran the repository's standalone
`ui-entry.tsx` fixture and XCTest workflow. All three selected tests passed:
`testLargeMarkdownSelection`, `testSelectLongAndCachedChats`, and
`testGalleryFromLatestTurn` (3 passed, 0 failed, 0 skipped). No physical-device
FPS, full-app memory plateau, or Android cache behavior is inferred from these
checks. Build logs and the XCTest result bundle remain local audit artifacts;
they contain no additional committed performance samples.
