# R40 round3 independent domain v4 verdict: REJECT

Exact rejected contract: `105c5763e5b59dbe4dd1845ec45fba53b4cea12530694648d81d48b8a099fee7`. Frozen bytes are `contract.md` in this directory, titled v4. Frozen api-map `b21b136a7a7e2725853822f326939a6bd695a8f69a6e4ce545eedd97626b413f`, schema `3d764e105588c0f8da40f82313b6b3885e1a05cbad175fae9915deba1e74397a`. The live repository contract changed to v5 during review; it is outside this verdict. In particular, `4f56b779b256182cfd12e087e59fcfa52ec2e797324d0cfbe5c69ebef9d87819` identifies that later live revision, NOT rejected v4. No replacement proof/approval is issued.

Baseline `EmojiCatalog.swift` equals declared commit 00e2a0e7 byte-for-byte: `c7f929ada6398c9c849e1b764e7bdacc3aca6956f3444fa74953db43cea5468e`. All writes are under `/tmp/pulpo-r40-domain-v4`; no production source edits or candidate implementation import. No private author, seal, costs, native/device, utility, push, merge, or deploy work. Executables compile unchanged baseline plus independently written controls. Synthetic Spanish eligibility/merge is a declarative contract model, never an implementation admission result.

## Smallest confirmed counterexample

Two JSON-decoded independent fixture entries: E has English name apostrophe+a (`"'a"`), L has English name `opaque` and Spanish alias U+FF9E U+0061. Full raw fixture bytes and outputs are in minimal.json; Swift is minimal.swift, Policy.swift, Matching.swift and unchanged EmojiCatalog.swift.

Compare raw q0=[FF9E,0061] and q1=[0027,FF9E,0061]. Both canonicalize under v4 to T={[FF9E,0061]}. U+FF9E is HALFWIDTH KATAKANA VOICED SOUND MARK but Swift classifies it as modifierLetter (Lm), Foundation letters admits it, and v4 therefore admits it as a BASE. It is neither Mn/Mc/Me nor mark-initial under v4. Q retains it. R is that same nonempty string. P(V(E)) and P(I(E)) are only `a`; neither the required substring nor the prefix witness succeeds. E(T) is empty.

Actual Foundation folds q0 to [FF9E,0061], but folds q1 to [0027,0061]. Unchanged actual search(q0,limit:1) returns []; search(q1,limit:1) returns [E] through exactNames. Thus an actual legacy result lies outside the REQUIRED envelope.

L is an exact Spanish token match. For q0, useful capacity requires L at cap1 (the canonical non-ASCII token begins with an admitted base and no indexed/exact projected English prefix exists). Canonical membership/order invariance requires the same localized tranche for q1. The fixed policy independently also allocates that slot because its envelope is empty. Preserving the English prefix makes q1 produce [E,L], violating cap1. Reserving E for the whole T fiber instead would suppress the required useful capacity for q0. This is a contract conflict, not merely a candidate implementation defect. The smallest confirmed witness has two canonical scalars, three raw scalars and two fixture entries; no exhaustive global minimality claim is made.

The minimal control preserves 24 raw cap/preference rows: 6 envelope-failure rows and 2 cap-exceeding rows. All rows, including repeated forms that do not return E, remain in the denominator.

## Ordinary indexed-name saturation confirmation

An ordinary name `bar` with keyword `bar wordN` reproduces the issue for raw apostrophe+FF9E+bar, without relying on technical exact lookup. U+FF9F (Lm) does too. For caps 1/48/60, fixtures have cap English entries with retained postings and 96 localized aliases. Actual English counts are 1/48/60; envelope counts are zero; localized tranche counts are 1/48/60; prescribed total counts are 2/96/120. `blocker.json` contains all 36 rows, including harmless spellings: 18 missing-envelope rows and 18 cap failures. No failed row is filtered.

## Fresh scan and retained denominators

- Unicode enumeration: 1,112,064 valid scalars visited. 141,988 admitted/mark/Foundation-letter-or-nonbase scalars receive ten contexts each, for 1,419,880 context screens; 2,543 Mn/Mc/Me scalars included. The other 970,076 scalars are enumerated but not context-tested. This is finite screening, not a universal Unicode proof. All 6 necessary-condition candidates are retained in scalar-scan.json: U+0E33/U+0EB3 contextual deletion and U+FF9E/U+FF9F contexts.
- Every one of those six candidates was then called through actual unchanged baseline search at caps1/48/60: 18 checks, 18 confirmed missing-envelope rows. See scan-confirm.json; none was excused as scan-only.
- Earlier-regression plus synthetic saturation set: 804 cap/preference rows; 0 failures in that finite set, including 390 useful-capacity rows with 0 failures. These passing rows do not erase the fresh failures. Controls include prior U0345, orphan Mc, t/he ignored-closure and prepend-letter cases; technical exact winners, final posting12 retention, fallback800 saturation, non-ASCII bases and all three mark categories, case/NFD/order/repeat/preference variants, and caps1/48/60.
- Real shipped catalog: 1923 entries, 8,671 distinct English-derived queries, 52,026 direct cap/preference calls, 121,354 returned results, 0 missing-envelope rows. 834 rows had empty T and remain present. Resource hash is recorded in environment.json. These are deterministic catalog controls, not utility families and not the separately required candidate paired7374 suite.
- Independent child challenge enumerated 2,543 marks and retained 66,390 multi-scalar contexts across 15 shapes; eight Foundation NFC anomalies are preserved. Its raw FF9E minimal witness independently reproduces the actual baseline failure. Its supplementary-mark recomposition issue is qualified as Foundation-API-dependent, since v4 prose does not require that particular NFC API; it is unnecessary to the rejection.

The original all-action candidate smoke, exact 7,374 paired candidate compatibility rows, full API contextual/lookup/history/query-buffer admission checks, universal envelope proof, source review, costs and native checks are NOT PASSED by this review. They were not completed or silently removed: the decisive preproduction domain gate failed, and the parent directed finalization without another replacement review. Public direct-search exact-name and indexed-prefix branches alone suffice to reject the universal claim. Prior v1/v2/v3 remain rejected and their artifacts are untouched.

## Disposition and next-round handoff

REJECT exact v4 before production edits. Preserve scalar-scan.json, scan-confirm.json, minimal.json, blocker.json, controls.json, real-catalog.json, Swift controls and every denominator. The new C=(T,W) and source-observable E_W proposal is recorded separately in proposed-next-round.md as UNREVIEWED; round3 does not patch or reapprove the failed formula. A fresh independent proof of exact replacement bytes must precede implementation.

Run commands are in run.sh. Hash manifest covers raw outputs, Swift sources, frozen normative inputs, executables and reports. No approval of live v5 is implied.
