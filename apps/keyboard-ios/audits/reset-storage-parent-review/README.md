# Reset storage: parent compatibility finding

R33's frozen `a9e6ecfc` storage candidate remains unadmitted by the parent.
Independent review found an unrelated compatibility regression: a new global
40-letter touch-learning cap also applies to models without a storage URL,
although the approved contract preserves their old length semantics. Durable
records already have a separate bound on the actual collected sample count.
The review found no additional concrete storage-ordering blocker; it does not
prove absence of other defects or complete runtime correctness.

The parent executed the same public-API client against immutable real
KeyboardCore packages at baseline `305a8893` and candidate `a9e6ecfc`, without
editing either source. Both Release clients exited zero. The five cases and
expected weights were written before either execution:

| Case | Target letters | Actual taps | Baseline weight | Candidate weight |
| --- | ---: | ---: | ---: | ---: |
| dense40 | 40 | 40 | 40 | 40 |
| dense41 | 41 | 41 | 41 | 0 |
| sparse41 | 41 | 40 | 40 | 0 |
| dense64 | 64 | 64 | 64 | 0 |
| tapless41 | 41 | 0 | 0 | 0 |

All taps are finite qwerty key-center taps. The intended target exactly matches
the typed word. Each case starts with a new `TouchModel(url: nil)`. Three old
adaptation controls regress. This is an exposed API compatibility witness, not
a blind benchmark, measured population accuracy loss or an installed UIKit
long-word reproduction. The source-only reviewer used nonzero finite offsets;
the separate executed parent witness uses key centers. Both yield the stated
sample counts, but they are distinct observations.

`public-api-witness/` retains the exact client, pre-execution intent, complete
paired JSON, recomputed comparison, and deterministic compressed archives of
the two actual package source trees. Archive hashes refer to decompressed Git
archive bytes. Each source archive contains Package.swift and Sources, with no
build products or model data. The client uses only public TouchModel, TypedWord
and geometry APIs; it does not load language resources. Successful build logs
were not read. Both temporary build trees remain outside Git.

For reproduction, extract each archive into a separate disposable directory,
create a Swift 6.2 executable package depending on its extracted
`apps/keyboard-ios/PulpoKeyboardKit` path and product `KeyboardCore`, and use the
unchanged `main.swift.txt` as Sources/Witness/main.swift. Run each with
`swift run -c release Witness`, redirecting stderr to its own build log.
Compare all five emitted rows with the pre-execution intent. No simulator or
production app data is needed. `verify.py` checks preserved bytes and recomputes
these observations; it does not execute Swift or prove the broader reset design.

`source-review/` preserves the independent review, fourteen final source/contract
snapshots, supporting source excerpts and earlier-version snapshots unchanged.
It read no hidden fixture or worker outcomes and performed no builds or device
operations. The parent runtime witness is separate evidence. Both source and
runtime identities are explicit; the older `4fa9` snapshots are historical.

The original R33 heldout result remains bound to its original frozen source.
This finding does not change that payload, oracle or raw result. R45 is a new
versioned correction and validation round; no later source can inherit the old
blind pass. The separate R41 failure-feedback UI and current dependency also
require their own integration evidence. Group clear does not erase inaccessible
extension-local fallback or transient contacts, and native suspension, iOS
storage latency and power-loss behavior are not established by this packet.
