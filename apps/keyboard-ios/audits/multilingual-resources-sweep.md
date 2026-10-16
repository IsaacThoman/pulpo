# Multilingual keyboard resource sweep

## Independently frozen acceptance benchmark

Frozen on 2026-10-16 before reading application source, test source, or audits. Base commit: 8e3bc1e1a83606cbb66cfc090e9abd44af61baa0. This document is owned by the resource sweep; parent QUALITY_AUDIT and other sweep findings are excluded.

Target: spare iOS 27 iPhone 18 Pro simulator 7E1D7979-7307-4C53-8466-BB41154B383C only. Native UI tests run serially. Simulator process memory is a simulator observation, never physical iPhone memory or evidence of a Gboard advantage. No physical deployment.

### Protocol and objective bounds

Measure the same release/configuration, simulator, fixtures, and invocation before and after. Collect at least three fresh-process cold samples per mode and five warm passes per mode where practicable. Report every sample, median, maximum, units, and measurement boundary; do not silently discard startup outliers. Cold means newly launched process with in-process caches absent; persistent vocabulary is separately reset or explicitly seeded. Warm means the same process after a complete prior pass. Distinguish engine/resource timings from visible keyboard/UI timings. Cold system disk caches are not promised. Native-test wall clock is not keystroke latency.

Acceptance gates fixed before optimization:

- Correctness/safety: zero crashes, hangs, lost/duplicated typed characters, mode mismatches, changed expected correction outputs, or learned-word cross-test contamination. No changes to dictionaries, language/compiler settings, ranking, dictation, Shift, existing frozen corpora, or parent QUALITY_AUDIT.
- Interaction cost: ordinary typing requires no extra taps; mode choice at most two taps once its chooser is visible; emoji open at most one tap, search focus at most one additional tap, insert at most one tap after a result is visible; dismissal/reappearance must retain selected mode and usable keyboard. Count taps independently of test synchronization waits.
- Latency: resource/engine request p95 <= 50 ms warm and <= 500 ms cold; mode switch resource readiness <= 500 ms warm and <= 1,500 ms first use; visible keyboard/emoji appearance or reappearance <= 1,500 ms, with any slower XCTest synchronization overhead identified separately. No claimed latency improvement from a timer that excludes the changed work.
- Memory/resource bounds: simulator resident memory <= 150 MiB for the measured keyboard-related test/host process (identify process precisely), post-warmup growth <= 10 MiB after 20 mode/emoji/dismissal cycles; persistent vocabulary test fixture <= 256 words; resource caches bounded by three supported modes or the finite built-in asset set. If process memory cannot be attributed to the extension, say so and use deterministic residency/load counters as complementary evidence, not a replacement disguised as RSS.
- Fix admission: a resource fix must remove measured redundant repeated work or demonstrate >= 10% median improvement in a directly affected measurement, preserve safety gates, and add a clear finite bound. Noise-level latency changes do not qualify. No acceptance thresholds may be relaxed after inspection. A failed or unmeasurable gate is reported, not retroactively passed.

### Development workloads (allowed for tuning)

D1 — English: fresh English mode; type `Please bring the blue folder at nine. We can meet near the library.`; request suggestions after each word and at prefixes `ple`, `brin`, `lib`; repeat warm five times.

D2 — Spanish: fresh Spanish mode; type `Mañana podemos tomar café junto al río. Lleva también el cuaderno azul.`; request suggestions after each word and prefixes `mañ`, `caf`, `cuad`; repeat warm five times. Preserve accents in the fixture.

D3 — bilingual: fresh English+Spanish mode; type `Please trae el cuaderno azul. Tomorrow tomamos café near the library.`; request suggestions at every word boundary plus `tom`, `lib`, `cua`; repeat warm five times.

D4 — switching/learning: cycle English → Spanish → bilingual → English 20 times in one process; after switching, request `ca`, `th`, `ma`. Seed 128 synthetic unique learned words (`devlex000` through `devlex127`), then query first/middle/last entries and repeat after resource reload. Existing production learning semantics remain unchanged.

D5 — emoji/lifecycle: open emoji, browse three categories, search `coffee`, clear, search `smile`, insert one result, return to letters, dismiss and reappear. Repeat 20 times; sample resources/memory before warmup, after warmup, and after cycles. Verify mode preservation. UI cost uses manual XCTest button taps where available; direct engine calls do not establish UI tap counts.

### Held-out workloads (run only after final candidate is fixed)

H1 — cold and warm mode passes with `A quiet train leaves before sunset. Pack the green notebook.`, `El sábado llega mi prima. Buscamos una mesa cerca del jardín.`, and `My prima arrives el sábado. Bring una chaqueta for the train.` respectively; prefixes `qui`, `jar`, `cha`.

H2 — reverse switching: bilingual → Spanish → English → bilingual for 20 cycles; request `re`, `pa`, `co`; use a separate 128-word fixture (`holdlex000` through `holdlex127`), checking first/middle/last retrieval after reload.

H3 — emoji/lifecycle: browse categories in reverse, search `train` and `heart`, insert, dismiss/reappear twice per selected mode for 20 cycles; verify mode and text retention. Use identical measurement boundaries and gates.

Held-out strings and sequences must not be used to tune implementation. If instrumentation cannot execute part of the protocol, retain the missing part as a limitation. New harness code may encode the frozen fixtures; existing corpora must remain untouched.

## Execution and findings

Pending source inspection and baseline measurement.
