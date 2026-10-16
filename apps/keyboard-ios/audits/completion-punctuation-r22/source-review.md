# R22 independent source review

Reviewed the `KeyboardEngine.swift` candidate diff against `31299362` and the frozen R22 protocol. Source SHA-256 reviewed and probed: `db5814f4bd326547ad69f2ec2615a4dcebb634ac493bbb2db4a53cd7c9a68b80`.

Verdict: no new safety regression found in this narrow source review or its development controls. One ordinary contract objection remains: an unambiguous closing run beginning with a comma and ending with a closing quotation mark retains the unwanted automatic separator. This is a retained baseline defect, not a newly introduced regression. It prevents claiming complete implementation of the contract's “entirely closing run” behavior.

## Concrete ordinary objection

At lines 813–815, the special first-character branch for comma/semicolon/colon checks only the next character for whitespace or end. Unlike the period/exclamation/question/closing-bracket branch, it cannot accept a closing run. Conservatism preserves `:)` and `;-)`, but also rejects the unambiguous quoted comma suffix `,” next`.

Using actual EN displayed slots (`literal|appoi`, `completion|appointed`, `completion|appointment`), select `appointment` after composing `appoi` with preserved prefix `book an `:

| Untouched suffix | Contract document | Candidate document | Candidate caret / required caret |
| --- | --- | --- | --- |
| `,” next` | `book an appointment,” next` | `book an appointment ,” next` | 20 / 19 |
| `," next` | `book an appointment," next` | `book an appointment ," next` | 20 / 19 |
| `,”` | `book an appointment,”` | `book an appointment ,”` | 20 / 19 |

All three fail identically in immediate, queued, own-lag, acknowledged, and reentrant modes. The literal selection has the same spacing miss in EN/ES/BI. The existing baseline expression also inserts this separator, so these are ordinary misses rather than regressions against `31299362`. No production adjustment was made as part of review.

## Safety, caret, and own-edit state

The controls preserve the separator before `.NET`, `:)`, `;-)`, `!important`, `“later”`, an ambiguous initial `” later`, and the mixed punctuation/word suffix `!”later`. They attach before `.” next` and `?! next`, and preserve an existing newline without adding a separator. Every available target selection preserved the exact suffix and left an empty selection. The caret stayed before the untouched punctuation; it never skipped over it.

All 65 available EN target selections had identical complete captured state across all five host modes, including composing text, Shift, `lastEdit`, and phantom-space state. Their post-acknowledgment state was also identical to their selected state, and all 65 delete-word Undo round trips restored the actual selected document/caret. This includes the ordinary spacing misses, whose undo remains internally consistent.

The source change uses the already reconciled optimistic `expectedAfterContext`; it does not inspect lagging live suffix context directly, mutate the suffix, delete host whitespace, or move the caret. `lastEdit` receives the actual inserted-separator decision in both literal and ordinary selection paths. End-of-document still gets its previous automatic space, leaving the existing punctuation-typed-after-selection swap branch intact. A non-whitespace character after the accepted closing run forces a separator, protecting punctuation-led following words. Opening delimiters and initially ambiguous quotes cannot enter the attachment branch.

No new objection was found to Backspace, explicit Space, capitalization, or subsequent insertion from the changed control flow. Those follow-on operations were inspected in source; this review's added controls do not independently exercise follow-on key steps. Native UI, arbitrary proxy-window truncation, and on-device behavior are outside this review's evidence.

## Reproduction and denominator

Development-only artifacts: `source-review-controls.json` and `source-review-results.json`. The opt-in existing `CompletionPunctuationR22Tests` runner was used unchanged; no fabricated Suggestion was selected.

Command (exit 0):

```sh
R22_INPUT=/private/tmp/pulpo-r22-completion-punctuation/apps/keyboard-ios/audits/completion-punctuation-r22/source-review-controls.json R22_OUTPUT=/private/tmp/pulpo-r22-completion-punctuation/apps/keyboard-ios/audits/completion-punctuation-r22/source-review-results.json swift test --scratch-path /private/tmp/r22-source-review-build --filter CompletionPunctuationR22Tests
```

195 rows = 13 inputs × 3 real language stacks × 5 host modes. EN displayed the target on all 65 rows: 50 exact full passes and 15 ordinary quoted-comma misses. ES/BI did not display `appointment` on all 130 rows; these remain unavailable failures in the full denominator, not successful selections. Total exact full success is therefore 50/195. Literal selection was displayed on every row and exact on 150/195; the remaining 45 have the three quoted-comma misses across all stacks/modes. The XCTest/Swift Testing test itself reports success because this opt-in runner records outcomes; the JSON is the correctness evidence.

No heldout contents were read. No production/runner edits, devices, deployment, logs, pushes, or parent-worktree edits were performed. Review wrote only these three development review artifacts in this R22 audit directory.
