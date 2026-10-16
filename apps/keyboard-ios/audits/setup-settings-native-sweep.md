# PR782 independent native setup/settings/privacy sweep

## Frozen protocol (before source, tests, or prior audit inspection)

Baseline: `5153837dbc25913d03a03ee53fe972589f844213`. Scope: the iOS companion app and keyboard extension's setup state, language preferences, permission transitions, reset/learning explanations, and keyboard dismissal. Expectations below are specified from the user brief and ordinary iOS user expectations, not inferred from implementation or existing tests. This is a coherent preference/setup continuity sweep, not an exhaustive application checklist.

Excluded: language models/dictionaries/assets; cache/performance; Suggester/typo ranking; inserted-text spacing; dictation sessions/destinations/return paths; selected-range reconciliation; Shift algorithms; key layouts/alternates. No production server, real-account messages, physical deployment, parent changes, or push. Only assigned iPhone 17 `1EDC5D9A-7E25-432A-B5B1-9A8B702306A7`; build output `/tmp/pulpo-settings-native-build`.

### Development tasks

- D1 Setup truth: open the companion before/after enabling its keyboard in iOS Settings. Setup instructions must distinguish installation/enabling from Full Access, reflect actual current state on return, and never imply that simply opening Settings completes setup.
- D2 Language continuity: select English, Spanish, and bilingual in companion settings, reopen the app and extension. Each explicit choice must persist and agree across the two surfaces when shared storage is available; labels must identify the active choice. Defaults must be deterministic.
- D3 Surface ownership: open settings from the companion and from the keyboard. Explain controls in the context where they take effect; make companion navigation and return/dismissal reachable. An extension-only limitation must not be represented as a successful global settings change.
- D4 Permission transition: inspect Full Access off, then on, then off again. Explain what permission enables and what still works without it; refresh state on returning from iOS Settings. Do not claim all local typing requires permission or promise unavailable capabilities.
- D5 Reset and learning: inspect personalization controls and any destructive reset. State what is learned, where it remains, and what reset removes. Require explicit confirmation for destructive learning reset; cancellation preserves preferences and learning. Avoid implying that learning reset changes language or iOS permission.
- D6 Keyboard show/hide: open the companion's local typing preview, show keyboard, open/dismiss settings, then hide keyboard and focus again. Reachable dismissal must work and reopening must remain possible without abandoning the page.

### Held-out tasks (do not execute until candidate selection is frozen)

- H1 Cold preference transfer: choose Spanish in one surface, terminate the companion, reopen the other surface, then choose bilingual and revisit the first. Expected: last explicit choice survives and remains consistent whenever the app group is available; no silent English fallback overwrites it.
- H2 Permission recovery: with Spanish selected, revoke Full Access in iOS Settings, revisit companion setup, re-enable it and return. Expected: permission status updates on each return, language survives, and local typing remains available where supported.
- H3 Destructive-action boundary: choose bilingual, cancel learning reset, then confirm learning reset and reopen settings. Expected: clear confirmation and accurate scope; language, setup state and permission remain unchanged.
- H4 Dismissal recovery: enter local preview text, dismiss keyboard through an available UI action, open/close settings, then focus the same field. Expected: text retained, settings closes, keyboard can be shown again; no external service required.

### Selection and acceptance

Inspect and exercise D1–D6 first. Select only reproducible, worthwhile production behavior/copy defects within this scope, then freeze candidate selection before evaluating H1–H4 once. Favor a general state/ownership fix over fixture-specific behavior. Validate changed production paths with native build and focused meaningful regression coverage. Record blocked/unpassed expectations separately from passes; simulator accessibility limitations are not product bugs. Do not broaden to excluded subsystems to obtain a pass. Held-out results may reveal limits but do not become an iterative tuning set.

### Evidence and reporting

Keep screenshots, transient harnesses and build output outside Git, under `/tmp/pulpo-settings-native-evidence` where applicable. Record exact protocol/implementation commits, commands, actual results and limitations here. Device tools attempted first: `device_list` reported iOS available but host failure `Device list failed: The device command failed (exit code 127).`; `device_open` returned the same error. Use the user-supplied pinned agent-device launcher/config/session fallback. Never read build logs unless the build command indicates an error.
