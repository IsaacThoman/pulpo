# Independent keyboard UX and safety sweep

## Frozen acceptance protocol — 2026-10-15

Frozen before reading implementation, tests, or any QUALITY_AUDIT findings. Baseline commit: `433e54adf29dc6960f2ffb5acafbf63699fb6494`. This branch is an isolated implementation worktree for PR #782. No simulator interaction or builds are permitted in this sweep; the parent owns simulator verification. Language selection and language features are excluded. QUALITY_AUDIT.md will not be read or changed.

These independently chosen tasks are the acceptance protocol. Findings and implementation choices below must be traced back to them; do not retroactively change the tasks to fit a fix.

| ID | Task | Acceptance metric |
| --- | --- | --- |
| U1 | Type a phrase, move the caret into its middle, select text, delete, then undo/recover where offered. Repeat with emoji and composed characters. | Each explicit editing action affects exactly its intended grapheme/selection; zero unexpected adjacent-text loss. |
| U2 | Start a press-and-hold editing gesture, drag outside its target, release, interrupt with dismissal, and reopen. | Zero edits after release/cancellation/dismissal; no stuck repeat or gesture state; explicit feedback for active gesture. |
| U3 | Dictate or request an AI edit, then move the caret or change the host document before completion. Cancel and retry. | Zero stale-result insertion or replacement; cancellation cannot apply a result; original text survives errors. |
| U4 | Reach companion setup and all nonlanguage settings using VoiceOver, large text, and reduced motion. Reach keyboard edit, mode, dismiss, and next-keyboard controls. | Every interactive control has a distinct meaningful accessible name and correct state; no essential action only available by gesture; no essential label clipped under large text. |
| U5 | Switch letters/symbols/numbers, shift/caps, return types, and app focus while composing. | Zero unintentional input/submit; visible state matches action; disabled/unavailable actions explain recovery. |
| U6 | Deny or revoke microphone/full access/network availability and attempt an AI/voice action; recover from companion. | Zero silent destructive edits; clear actionable failure; no request or recording continues after explicit cancellation. |
| U7 | Use compact portrait/landscape layouts and one-handed edge touches, including candidate/action strips. | No overlapping actionable targets; frequent noncharacter controls meet 44pt target where layout permits; alternate accessible action exists for precision-only gestures. |
| U8 | Preview and change a privacy-sensitive setting, leave/reopen companion, and revisit explanatory copy. | Persisted state matches displayed state; copy accurately identifies permissions/data effects; destructive actions require intentional activation. |

Measurements will distinguish executable unit evidence, static inspection, and parent-only device verification. Device latency, actual VoiceOver focus, physical target sizes, and visual clipping remain unmeasured until the parent runs the prescribed UI checks.

## Findings, changes, and verification

Pending inspection.
