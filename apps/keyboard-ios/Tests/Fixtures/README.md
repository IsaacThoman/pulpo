# Fixed regression fixtures

These JSON files are byte-preserved inputs migrated from the keyboard experiment
archives. Core tests resolve them relative to `LanguageData`; AppTests and UITests
resolve them relative to their source files. They are test inputs and do not ship
in either the app or extension.

- `shift-sequence-probe.json`: repeated Shift and typing sequences.
- `parent-language-holdout.json`: multilingual suggestion/entry checks.
- `paired-typing-probe.json`: opt-in paired typing sequences
  (`PK_PAIRED_TYPING_SPLIT`).
- `native-content-types.json`: expected privacy mapping for native UIKit traits.
- `cursor-editing/`: preview cursor/range and broad editing inputs.
- `inserted-text-spacing/`: inserted text and boundary spacing
  (`PULPO_SPACING_SUITE=development` or `held-out`).
- `swipe-eligibility/`: opt-in dictionary/swipe eligibility cases
  (`PULPO_R10_OUTPUT` and `PULPO_R10_SPLIT`).
- `compact-layout/`: UIKit compact-layout matrices.

Historical names such as `heldout` and `fresh` identify the original splits;
replaying them now is regression validation, not a new blind evaluation. The two
completion-candidate input files remain under `benchmarks/completion-candidates`.
Write generated reports and screenshots outside the checkout.
