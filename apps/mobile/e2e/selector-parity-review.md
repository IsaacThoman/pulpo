# Model selector, presets, and native control review

Reviewed September 5, 2026 on Android 17 / API 37 and iPhone 17 Pro / iOS 26.5, with both apps signed into the same authorized production test account. The earlier layout review incorrectly treated a five-model shortcut as an acceptable equivalent to the iOS selector. The earlier interaction audit checked that selection worked, but missed its different organization and missing icons. Those claims are superseded by this review.

## Root causes and corrections

- Android constructed a separate, capped five-model list instead of using iOS’s complete Favorites/Labs organization. Both presentations now use the same tested section resolver and preference ordering. Switching labs keeps the selector open, returning to that lab’s models; selecting a model closes it. Empty favorites do not silently substitute arbitrary models.
- The Android adapter accepted only a flat action list and vector symbols. It now supports sections, nested navigation, stable action IDs, and image assets. The model trigger, model entries, lab entries, and searchable catalog use the existing model/lab logos without monochrome tinting.
- Preset groups now show their title once, with plain choice labels and a separate selected checkmark for each group. Identical labels in different groups dispatch to the correct preset. Each platform retains its native menu placement/order behavior.
- Icon padding was inside the icon’s constrained dimensions, shrinking the drawable. Buttons now use a full 24 dp icon and a separate spacer, with explicit 16 sp semibold text. New Chat grows vertically at large font scales. Menu labels use explicit Material typography and a minimum menu width.
- The related catalog audit found filtering by display name instead of provider ID, ignored saved favorite/provider order, missing model images, and a different large-text entry path. These now use the same IDs/preferences and the full searchable catalog at large text, matching iOS’s fallback. Action supporting text and image assets also survive the centered fallback presentation.

## Device checks

| Check | Observed result |
| --- | --- |
| Same production Favorites on both devices | All seven entries in the same saved order: GLM-5.3 Flash, GPT-5.6 Luna, DeepSeek V4 Flash, Grok 4.6, Gemini 3.7 Flash, MiniMax M3, Claude Sonnet 5. Android header/menu logos render. |
| Same Labs on both devices | Favorites plus all 13 labs in the same order. Selecting OpenAI keeps the menu open and shows Luna, Terra, and Sol on both. |
| Selection and cancellation | Android model selection closes the menu and updates the header. Returning from Labs without selecting leaves the model unchanged. An isolated fixture model without presets hides generation options. |
| Preset parity | Terra exposes all five Reasoning and four Speed choices, grouped once with independent checkmarks. Selecting High on Android updates iOS to High · Auto, preserving Speed. Restored Medium · Auto afterward. |
| Compact Android width | At 320 dp wide, scrolled through the full Labs list to Inception and selected the lab; its two model entries appeared in the still-open menu. |
| Android 200% text | Header opens the full searchable catalog. Search for Terra works with the keyboard visible; selecting the visible result closes the catalog. New Chat remains legible and unclipped. |
| Android light/dark | Model and lab assets remain readable in both appearances. Normal display size, font scale, and light system appearance restored. |

Production verification changed draft model/preset controls only; no messages were sent or existing conversations modified in this follow-up. Credentials are not stored in these artifacts.

## Validation and bounds

- Mobile: **60 test files / 374 tests passed**.
- Mobile TypeScript, repository lint, Android/iOS exports, and whitespace checks passed.
- Added regression coverage for complete Favorites, saved order, deleted labs, distinct provider IDs with identical display names, grouped preset dispatch, and submenu dismissal behavior. Removed the test that codified the incorrect five-model cap.
- This is a focused correction of selector/preset/control parity, not a claim that every app state is equivalent. The earlier audit’s physical-device, assistive-technology, passkey, and Agent-service limitations still apply.
- The live Android appearance issue identified in this pass was subsequently fixed and device-verified in the [screen quality and motion review](android-quality-review.md).

## Evidence

![Android complete Favorites with logos](evidence/selector-parity/android-favorites.png)
![iOS Favorites on the same account](evidence/selector-parity/ios-favorites.png)
![Android grouped preset choices](evidence/selector-parity/android-presets.png)
![Android New Chat control](evidence/selector-parity/android-new-chat.png)
![Android model catalog at 200% text](evidence/selector-parity/android-large-catalog.png)
![Android New Chat at 200% text](evidence/selector-parity/android-large-new-chat.png)
![Android model logos in dark appearance](evidence/selector-parity/android-dark-models.png)
