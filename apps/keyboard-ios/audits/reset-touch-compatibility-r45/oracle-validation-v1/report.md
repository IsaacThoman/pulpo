# Independent source-blind validator — v1

**QUALIFIED ACCEPT. No authorship correction blockers found.** This is a pre-freeze static review, not a product result or a joint freeze.

Reviewed all author fixtures, runner, rationale/schema, denominator manifest, read-set, attestation and hashes against the authorized public map. Independently reconstructed **24 families, 34 mode instances, 652 planned checks, 68 learn steps (46 accepted expectations / 22 rejected expectations)**. All sample annotations, normalized alignment, acceptance, control histories and denominators agree. Hashes and provenance metadata are internally consistent; historical read claims remain self-attestations.

Independently recomputed source-character expansion and normalized letter sample streams, ignoring extra/nonletter taps while rejecting contributing nonfinite values. Persistent boundaries count per-call samples rather than target length or original tap count. Accepted weight uses a finite increase and equivalent ordered local control; rejection uses exact weight/offset bit patterns. All fixed histories stay below the qualified weight-decay domain. No private numerical constant is invented.

Reviewed all public constructor/property/normalizer/geometry/storage-authority/learn/save/reopen/reload calls, settled rejection baselines, nil-URL cwd isolation, recursive filesystem membership/bytes/type/inode/device/symlink/mtime comparison, zero retries, busy/error classification, preservation of failures and unavailable checks, output publication and process exits. Thirteen save/reopen sequences, nine settled seed saves, five normalization assertions and one explicit nil save are planned. The ledger does not silently discard pending or failed checks.

Declaration-only public API typecheck **passed** using Apple Swift 6.4 in Swift 6 language mode. The stub was emitted solely from the approved map, contains declarations only and was never executed. There was no link, product module read/build, product execution, or behavioral mock. This does not certify a separate Swift 6.2 compiler installation. Static/synthetic adversarial checks passed **348/348** oracle predicate checks and **12/12** JSON accounting checks. These numbers are validator checks, separate from the 652 planned product checks.

## Before-freeze integration conditions

- Set **`entrypointFileName: "main.swift"`**. The exact runner has top-level execution, with no `@main` type.
- Invoke the paired driver with an **absolute root**, or correct it to resolve the root. It currently accepts a relative root whose subprocess paths can resolve incorrectly after cwd changes.
- Driver exit zero is transport completion. Independently require the two designated version records, successful builds, exactly one product execution each, retained child exits and full result accounting. The driver itself does not propagate child failures or validate result JSON. The supplied `output-accounting.py OUTPUT_DIR RUNNER_EXIT` audits each retained result without running product; its own zero means valid accounting and its metadata separately states `completePass`.
- Joint freeze must include exact runner/input/driver/archive hashes and per-version Swift manifests. The driver consumes these declarations; it does not enforce that the future freeze includes every necessary entry or exactly two versions. No source archive or freeze was read here.

No original artifact was edited. These conditions do not require fixture authorship changes; an altered runner/input would need a new separately identified author/validator round.

## Executable and output contract

`executable /absolute/fixtures.json /absolute/fresh-output-dir`

Exactly two user arguments. Output directory must not exist; its parent must exist. Output comprises `results.json`, 24 family JSON files, and 34 instance work directories under `isolated-work/`. The aggregate includes full families/checks/events and check/pass/fail/unavailable/error totals. A clean result has exactly 652 passing checks and no publication errors. Exit 0 requires complete pass; exit 1 indicates failed checks (possibly with errors/unavailability); exit 2 indicates unavailable/error/incomplete/setup/output failure without a failed check. Setup/publication failure may leave no usable aggregate and must not pass.

## Exact SHA-256 identities

- `fixtures.json`: `1d48e1bf2f65d45113b917106dfc10a48a32cc3e068be23535a7ada6694d5fe4`
- `runner.swift`: `8a2dd587cfe9f1a04306e216581cce3eb378fbc340e171aacb127f6635bf0243`
- `sha256-manifest.json`: `6d0977910f07f2825a3821ac05f7da48e07560b18a24fe387c238dd0fa7aeba0`
- Public map: `188a0221590ff03b10de42b371949bbb2c0ba32def167da1690a5e9bdfcbbd41`
- Reviewed unfrozen driver: `ea7db3e2f1b2a272232373c28d39f5587b0e1402e2b3fd3cd10f6c3aa91c2c47`

Full hashes, per-instance counts, qualifications, read/write attestation and review findings are in `report.json`. `static-results.json`, `adversarial-results.json`, `accounting-synthetic-results.json` and the declaration-only typecheck artifacts retain the independent static evidence. No fixture text or taps are reproduced in this report.
