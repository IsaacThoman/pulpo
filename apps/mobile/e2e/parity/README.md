# Interaction parity flows

These Maestro flows accompany the September 5 device audit. They operate on disposable local fixture data, not production accounts. Use the iPhone 17 Pro simulator with the native Pulpo debug build and the local queue API/provider from the parent e2e directory.

The flows are stateful reproductions, not an unattended clean-install suite:

- `ios-message.yaml`: open `Parity Android actions` with three assistant versions: original, `Edited Android response`, and a regenerated original. Version 3 must be selected. Exercises version switching, copy/reply, edit cancellation, regeneration to version 4, deletion cancellation, and user-edit cancellation.
- `ios-history.yaml`: start in a conversation with history closed and an unpinned `Parity Android actions` chat. Exercises search/clear, pin/unpin, rename cancellation, and duplication. The pin step reproduced the native preview-dismissal crash before the fix.
- `ios-history-mutations.yaml`: continue with history open and the duplicate from the previous flow. An `Android QA` folder must exist, automatic expiration must be enabled in Data Controls, trash retention must be indefinite, and trash must initially be empty. Exercises folder assignment/removal, expiration, trash, restore, and permanent deletion of that duplicate.

Run with `maestro --device <iPhone-simulator-UDID> test <flow.yaml>`. Do not run concurrent flows against the same device or edit the same synchronized draft on both devices at once. Native system dialogs and picker selections were additionally checked using their current accessibility trees and screenshots.
