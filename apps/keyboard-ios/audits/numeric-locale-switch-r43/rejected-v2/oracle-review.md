# R43 V2 independent oracle review

Reviewed only `contract.md`, `public-protocol.md`, `oracle.py`, `oracle-schema.md`, and `references.json` in this V2 directory. No V1 artifacts, production sources, tests, resources, author inputs, author results, or gold were read or modified. Synthetic self-tests stayed in memory. V1 evidence remains rejected; no V1 gold was reused.

Changes before fresh authoring:

- Added email and URL to the disabled-learning keyboard states. Counts and dirty flags must remain unchanged there, including the post-field-action state. Ordinary standard prose remains allowed to learn; private fields remain disabled regardless of keyboard.
- Aligned the interchange schema wording with the public address-privacy contract.
- Tightened locale identifier validation from region-only identity to the exact requested locale base, permitting Foundation/Xcode `@`/encoding suffixes and hyphen spelling. Current and autoupdating region and separator gates remain independently required. This enforces the schema already requiring requested locale identity and V2 exact AppleLocale.

Preserved fail-closed gates: all 12–24 rows remain in input order and denominator, including unchanged rows; errors at all levels fail; missing/extra rows or actions fail; unsupported operations or keys fail validation; exact text and callback counters, post-action document callbacks, dictionary availability/bytes/SHA, requested/loaded/native languages and stack identities, initial seeded text, privacy/learning continuity, native geometry/routing, exact digits/separator/globe requirements, nonoverlap, and numeric bottom target minimums remain checked. No runtime failures are waived or converted into completions. Portrait and landscape size policies remain distinct. No installed OS-menu claim is made.

Self-tests: 51 passed using a synthetic 12-row evidence set spanning all six keyboard kinds, all four locales, three typing modes, secure/nonsecure states, seeded text, unchanged rows, both globe routes, and field transitions. Standard allowed learning can increase; numeric/private/address learning cannot. The baseline passed and each listed negative mutation was rejected while retaining all 12 denominator rows.

- `baseline-12-rows-address-private-numeric-standard-and-transitions`
- `email-policy-allowed`
- `url-policy-allowed`
- `address-count-growth`
- `address-dirty-change`
- `field-into-email-policy`
- `field-out-of-url-policy`
- `private-standard-policy`
- `numeric-policy`
- `ordinary-standard-policy`
- `missing-row`
- `extra-row`
- `wrong-row-order`
- `duplicate-row-id`
- `unchanged-row-error-retained`
- `top-level-runtime-error`
- `action-runtime-error`
- `missing-action`
- `skipped-action-index`
- `missing-document-callback`
- `wrong-locale-region`
- `wrong-arabic-separator`
- `wrong-locale-language-same-region`
- `wrong-autoupdating-locale`
- `dictionary-hash-mismatch`
- `dictionary-empty`
- `requested-language-mismatch`
- `loaded-language-mismatch`
- `native-stack-missing`
- `initial-seeded-secure-text-lost`
- `globe-edits-document`
- `globe-callback-wrong`
- `learning-continuity-lost`
- `exact-final-text-mismatch`
- `numeric-digit-missing`
- `required-globe-missing`
- `unexpected-globe`
- `cap-outside-grid`
- `target-overlap`
- `portrait-bottom-under44`
- `routing-centerRoutes`
- `routing-targetRoutes`
- `routing-identityRoutes`
- `routing-rootRoutes`
- `unknown-operation`
- `unsupported-number-page`
- `generic-globe-forbidden`
- `unavailable-digit-separator`
- `arbitrary-text-insertion`
- `blank-key`
- `composed-character-native-backspace`

Frozen oracle SHA-256: `a0e690399ff9c932031c94eae3faf22b930cc8d46ad10f64e2461f13650b074c`.

Denominator clarification: all malformed-output mutation verdicts retained all 12 rows. Invalid-input protocol tests correctly fail validation before any scoring denominator exists.
