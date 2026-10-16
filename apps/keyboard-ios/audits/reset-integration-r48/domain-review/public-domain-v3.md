# R48 public domain v3 — exact runtime operations and result semantics

This map specifies a public-API compatibility domain. Before authoring begins, approve and hash-bind this semantic map and declare the public protocol/capabilities. The author may then design literal cases and propose the corresponding schema/runner without querying the product. Final authored inputs, schema, runner, reference and product-source versions must be independently validated and hash-frozen before any product execution. This author-facing document contains no product source, prior round history, calibration payloads or candidate results.

## Execution and oracle boundary

The eventual runner uses a standalone Swift executable importing public KeyboardCore and Foundation, fresh unique temporary storage, and no dictionaries or devices. The author may independently inspect literal Swift String/Character/Foundation behavior under this map, but must not query KeyboardCore/TextNormalizer/TouchModel or inspect product sources, old cases/results, dictionaries or candidate outputs before literal expectations are sealed. Approved independent Foundation-only reference code may implement this public specification; it must not call a product API to generate or repair expectations. Authoring is followed by independent input/oracle/relational validation and strict schema/runner/reference review, including adversarial corruption/type/ID tests. A preexisting generic scaffold is optional, not a prerequisite that requires nonexistent authored inputs. Before product execution, freeze exact authored inputs and all final execution/validation/reference/source bytes and record their hashes. Only then may one paired product execution occur per frozen version. No preexecution mechanics are waived and no source-blind author may inspect fresh product replies before this freeze. A revealed failed round is retained, not retuned in place.

Runtime binding is Apple Swift6.4 (swiftlang-6.4.0.34.1), macOS27.0.1 build26A434, arm64, for these preauthor calibrations. Record actual compiler/runtime for the final runner. Swift Character segmentation, Swift scalar properties and Foundation compatibility decomposition use their respective runtime tables; this map does not certify a single abstract Unicode version or every other platform. Recalibrate before changing runtime. Do not substitute Python Unicode tables, NSString/ICU casing, locale-specific folding, or textbook casing expectations for the required operations.

## Public APIs and state observations

`TouchModel(url: URL?)`, `weight: Double`, `offsets: [KeyPoint]`, `persistenceResult: LearningPersistenceResult`, `isLearning: Bool`, `learn(_: TypedWord,intended:String,geometry:LetterGeometry)->Bool`, `save(inBackground:Bool=false)->Bool`, and `reloadIfChangedOnDisk()->Bool` are public. `TypedWord(text:String,taps:[KeyPoint?])`, `KeyPoint(x:y:)`, `LetterGeometry.qwerty.center(UInt8)` and `TextNormalizer.key(String)` are public. Persistent models use a fresh unique canonical `TouchModel.json` URL. The model's normal queries expose its current in-memory projection and perform no observation I/O.

`persistenceResult` is the result of the **last attempted operation**, not a persistent read-validity flag. Its enum cases are `ok,busy,capacity,invalid,io,uncertain,cleanup` with rawValue. Treat each operation's Bool and result separately:

- A nil-URL model initializes successfully with `.ok` and empty local state. No disk read is required for this local projection.
- A persistent constructor/fresh reopen must explicitly report `.ok` before its count/weight/offsets can establish a successful durable observation. A non-ok constructor may expose default zeros; those zeros are unavailable as durable evidence.
- `reloadIfChangedOnDisk` returning **false with `.ok`** means successful observation with unchanged visible projection; this is a valid normal result, including a nil-URL reload. False with non-ok means failed/unavailable observation. A changed persistent projection may return true/.ok. Never require reload Bool true merely to recognize read success.
- `learn` true/.ok means registered and locally applied for persistent models, or locally applied for nil models; it does not mean synchronous payload durability. Intentional input rejection returns false/.invalid without new teaching. The stable preexisting in-memory projection remains a valid object of no-mutation comparisons even though the last-operation status is now invalid.
- A synchronous `save(false)` true/.ok means confirmed completion; it may commit earlier accepted learning. Nil-URL save is a successful local no-op. `save(true)` means background enqueue only and does not establish completion or a new successful read. The blind boundary harness should use synchronous saves and no concurrent/background work unless an explicitly approved schedule supplies completion semantics.
- Unexpected busy/io/capacity/uncertain/cleanup cannot be converted to expected empty state or counted as a successful intended observation. Retry only bounded read observations that report `.busy` where the frozen protocol explicitly permits; never automatically replay a mutation. Intentional false/.invalid controls are normal specified outcomes, **not** benchmark infrastructure failures.

## Exact normalization

1. If every input UTF8 byte is below128, drop byte0x27 (ASCII apostrophe), map ASCII A-Z to a-z, and preserve every other byte, including NUL, controls, digits, underscore and punctuation.
2. Otherwise call **Swift `String.lowercased()`** on the complete input, then Foundation `decomposedStringWithCompatibilityMapping` on that result. Iterate its Unicode scalars, dropping ASCII apostrophe U+0027, right apostrophe U+2019, and scalars whose Swift `properties.generalCategory` is `.nonspacingMark`. Preserve all others in order.

These are ordered operations. This is not full case folding, canonical-only decomposition, locale-specific casing, removal of all mark categories, all punctuation, or a promise of ASCII output. Compatibility decomposition may emit uppercase characters after lowercasing, so normalization need not be idempotent. Spacing/enclosing marks and format characters are not removed merely for being nonletters. The all-ASCII branch has no Unicode normalization step.

**Do not substitute `(input as NSString).lowercased`.** Its contextual casing behavior can differ from Swift String.lowercased. Use the exact specified Swift operation rather than an assumed Unicode-context rule; a general expectation of context-sensitive final-sigma mapping is not part of this map.

## Character alignment and actual samples

For the typed text, enumerate original **Swift Character** positions. Normalize `String(character)` independently using the exact rules above. For each resulting UTF8 byte, append one aligned entry carrying that original Character's optional tap. A multi-byte/non-ASCII result still duplicates the point per byte; it does not necessarily produce ASCII letters. Missing point positions are nil. Extra supplied taps beyond original Character positions are ignored. A removed Character can produce zero byte entries. Do not index taps by original scalar or original UTF8 byte.

Normalize the intended target as a **complete String**, separately from the per-Character typed expansion. Require normalized target byte count to equal the typed expansion's byte count, and target byte count at least2. Spelling equality is not required. Execute these distinct specified operations even if their results happen to agree for a given runtime/input; do not assume NSString contextual casing or an unproved context-sensitive difference.

At each aligned target byte, only ASCII a-z with a nonnil aligned tap and a qwerty center contributes a sample. Its raw displacement is the absolute tap minus the center of **that intended target byte**, not the original typed byte. All qwerty a-z have centers. Nonletters and nil positions produce no sample. A nonfinite displacement rejects the whole call only if that position would contribute; a nonfinite point at an ignored position does not reject other valid samples. No partial teaching occurs if a later contributing position is invalid.

With learning enabled, matching length/min2, at least one sample, and finite contributing displacements:

- Nil-URL local models admit the operation without an upper target-length or contributing-sample cap.
- Persistent models admit at most40 **actual contributing samples per invocation**; target length alone is not the cap. More than40 actual samples rejects false/.invalid. This is distinct from storage-resource `.capacity` backpressure.

Learning Off, length mismatch, target shorter than2 bytes, zero contributing samples, or contributing nonfinite displacement returns false/.invalid. Rejection means no new learning from that call, not reset of existing calibration or cancellation of prior accepted learning.

## Settled invariants, relations, and rejection scope

Settle successful construction and all preseed/previous accepted work with confirmed synchronous saves before measuring a rejection boundary; do not leave scheduled background work or other processes active. Under those conditions, the front-end intentional `.invalid` rejections above preserve settled learned weight/26offsets and learned-file content. Diagnostic status may change. Define file checks as a bounded inventory plus regular-file content hashes if the schema requires them, not an unqualified promise that all filesystem metadata is immutable.

**Do not generalize no-file-effect to storage failures.** A first otherwise-valid admission may allocate a writer sidecar before a busy global lock is reported. Failed/uncertain storage operations can alter reservation/ack metadata or have committed; cleanup is postcommit. Saves can commit prior accepted work. Busy/io/uncertain/cleanup are not a global unchanged-data contract. Missing/malformed fresh read is unavailable, not a zero-state pass.

Successful persistent sequences, after confirmed save and successful fresh reopen, must agree in weight and all26offsets with an equivalent local sequence of the **same accepted sample-producing calls in the same order**. Exclude intentionally rejected persistent calls from that persistent-equivalence reference; separately assert their retained-state relation and the deliberately different local acceptance policy. Do not assume the comparison version must satisfy every desired policy; retain paired changed/unchanged failures honestly.

Weight is the sum of26 per-key weights; each key decays at300, so arbitrary repeated same-key learning is not sample count. Raw offsets expose estimates even below an external corrector's evidence threshold. Final bounds clamp x and y individually to ±0.4; this is not a0.4 Euclidean-vector bound. Per-kept-word reference, sample-radius clamp, sample order and decay are conserved. Prefer independent full-state equivalence relations over copying/reinventing the update formula. Output weight and every offset component must be finite; comparisons require the frozen explicit numeric tolerance, exact26-entry order a-z, exact operation/ID accounting, and nonvacuous accepted controls.

The schema must reject malformed/unknown fields or operations, incorrect IDs/counts, type coercions, invalid state dimensions and nonfinite numeric observations before scoring. If deliberate nonfinite **input** points are supported, encode them with explicit approved tags; do not admit invalid JSON NaN/Infinity as ordinary numbers. An expected rejected input is different from a corrupt record. Independently validate oracle relations before sealing, without product replies.

## Limits

This validates TouchModel public-API editing/learning compatibility under a specified domain, not population EN/ES/BI accuracy, ranking, all Core behavior, whole shared reset, native iOS behavior/latency, inaccessible fallback erasure, spoken VoiceOver or Gboard superiority. Whole product source-tree differences between comparison and candidate must be retained/qualified by the executor without exposing implementation to the author. Parent must approve/hash the map and declared public protocol before authoring; independently validate and freeze all final authored/execution materials before product execution.
