# Read-aloud local QA

Validated on 2026-09-08 using an isolated PostgreSQL/Redis instance, filesystem blob storage, the real Pulpo API and web application, and an OpenAI-compatible local fixture provider. The fixture returns valid WAV audio through binary and SSE responses and can simulate errors, missing usage, and delayed generation. Existing local application data and external providers were not modified.

## Selection regression

Selecting a voice in the full Settings → Interface dialog could make the dialog appear empty. Focusing the absolutely positioned, visually hidden radio scrolled the outer dialog instead of the voice list. The reproduced dialog had `scrollTop = 982`; its content was still mounted and the preference saved successfully.

The voice label now establishes the radio's positioning container. With the fix, the outer dialog stays at `scrollTop = 0` and `scrollLeft = 0` after selection.

Repeatable browser check:

1. Configure a speech model with all 13 preset voices and a second model with different capabilities.
2. Open the complete app's Settings → Interface → Speech, select the first model, and scroll to the bottom of its voice list.
3. Click each voice label, including Marin and Cedar. Confirm the settings navigation and close button remain visible and usable.
4. Use arrow keys on the selected voice. Confirm selection moves and only the intended list/content region scrolls.
5. Repeat at 1100px and 390px widths, in light and dark themes. Switch models, reopen settings, and reload the app.

All 13 voices were selected at both widths after the fix. Keyboard navigation passed, the outer dialog stayed stationary, and neither viewport overflowed horizontally. This is a layout/focus regression: jsdom component tests alone cannot reproduce it.

## Full application checks

| Area | Result |
| --- | --- |
| Settings | Model dropdown and voice list remain distinct. Voice, instructions, and speed persist through the actual settings API and reload. Per-model selections survive model switching. Unsupported controls are hidden. |
| Voice previews | Uploaded separate clips for Alloy and Coral through the admin editor. Both were advertised in the catalog and played through authenticated blob downloads. Previewing did not select a voice. Removing Alloy's clip left Coral playable; deleting a voice made its clip unavailable. |
| Message playback | Both user and assistant actions work. A long assistant message generated and played four ordered chunks, each within the configured character limit, using the saved voice, instructions, and speed. |
| Text extraction | Headings, lists, table text, inline code, and link labels survived. Fenced code and raw URLs were omitted. |
| Ownership and cleanup | At most one chunk was prefetched. Stopping after the prefetch prevented further requests. Switching to the user message kept one active player. Chat navigation and leaving Speech settings stopped playback. All observed generated object URLs were revoked. |
| Errors | Browser playback rejection returned to idle with a recoverable message. Missing token usage, invalid audio, and upstream errors produced sanitized failures. Unsupported settings were rejected. |
| Unavailable selections | Disabling a selected model preserved its ID and displayed “Selected model unavailable.” Removing a selected voice preserved its preference and displayed “Selected voice unavailable.” No provider fallback occurred. |
| Authentication | Unauthenticated catalog, admin catalog, and preview requests returned 401. Authorization and secret-isolation regressions also passed in the server suite. |
| Billing | Real generation endpoints produced ledger costs of 3 microdollars for three Unicode characters, 2,000 microdollars for two audio seconds, and 246 microdollars for 10 input/20 output tokens at the configured fixture rates. Duplicate generation returned 409. Failed and cancelled incomplete requests added no charges. No speech request-log records were created. |
| Backup/restore | A complete archive was created, the catalog was modified, and the archive was restored in the isolated database. Both clips survived byte-for-byte with remapped blob keys and the original catalog restored. |

The shared-client suite covers cancellation races, chunk boundaries, and playback sequencing. Database-backed accounting tests passed for insufficient funds with rollback, subscription allocation, and pool funding.

## Compact voice selector follow-up

The voice selector now shows only the selected voice until opened. Web uses Pulpo's existing popover; mobile expands a bounded, scrollable list. Selecting a voice collapses the list, while each optional preview button remains independent. Closing the picker stops its active preview. The model remains a separate dropdown.

Repeated the full web Settings → Interface check against an isolated local API:

- Selected all 13 voices at 390px and 1100px widths in both light and dark themes (52 selections). Each selection updated the collapsed row; the outer dialog stayed at `scrollTop = 0` with no horizontal overflow.
- Reopening the popup focused and revealed the selected voice, including Cedar at the end of the list. Arrow keys and Home/End navigated without closing it; Enter selected, Escape dismissed and restored trigger focus, and clicking Instructions dismissed it.
- Uploaded a WAV preview for Coral. Playback kept the popup open and Alloy selected. Dismissing the popup returned playback to idle.
- Web settings/admin/message tests: 47 passed. Mobile settings/playback/preferences tests: 15 passed, including collapsed state, independent previews, selection, and preview cleanup on both platform branches.
- Web production build, mobile typecheck, and workspace lint passed. No server schema or migration changes were required. Physical native UI validation remains unperformed.

## Automated validation

### Dropdown scroll regression follow-up

The earlier compact-picker QA exercised selection and programmatic focus scrolling but missed actual wheel/touch input. The settings dialog's scroll lock blocked those events because the non-modal popover was portaled outside the dialog. The voice popover now owns a nested modal scroll lock, permitting scrolling inside its list while retaining the background lock.

- Reproduced in the full app: a 280px wheel gesture left the list at `scrollTop = 0` despite 628px of content in a 318px viewport. After the fix the same gesture moved it to 280px, and further scrolling reached the 310px bottom boundary.
- At 390px width, wheel gestures reached both ends. A Chromium-emulated touch swipe moved the list from 310px to 60px. The outer settings dialog stayed at zero.
- Selection, arrow/Enter navigation, Escape/focus return, independent preview playback, and dismissal with preview cleanup still worked.
- A regression test renders Speech settings inside the real modal Dialog and asserts wheel/touch events are allowed through for its scrollable popover. It failed before the fix and passed afterward. All 48 targeted web tests, the web production build, and workspace lint passed. Physical touch-device validation remains unperformed.

### Initial full-feature checks

- Shared speech: 7 tests passed.
- Web settings, admin voice editor, and message actions: 45 tests passed.
- Server speech, previews, backup compatibility/projection, and preferences: 37 tests passed.
- Mobile speech settings, playback lifecycle, and preferences: 15 tests passed.
- PostgreSQL speech accounting: 3 tests passed.
- Web production build and workspace lint passed.

## CLI management follow-up

Speech catalog CRUD is available through `pulpo speech-model`, with an offline
editable preset and per-voice `preview upload/download/delete` commands. The
management API advertises `speechModels` and enforces current administrator role
plus `catalog:read`/`catalog:write`. Multipart uploads and audio downloads reuse
the web feature's validation, storage, audit, and cleanup handlers.

The built CLI was exercised against a fresh isolated PostgreSQL/Redis/API
instance using real scoped management tokens:

- Created a model from its CLI preset, listed/read it, and updated all three
  billing configurations. Catalog output did not expose the provider key.
- Uploaded separate Coral and Alloy samples, downloaded identical bytes,
  replaced Coral, and removed only Coral's clip. A read-only token downloaded
  audio but could not upload it; noninteractive deletion required `--yes`.
- Invalid audio and unknown voices were rejected. A provider referenced by a
  speech model could not be deleted. A disabled model remained manageable by
  its administrator.
- Set/read account speech preferences through CLI management settings. Model
  disable/deletion preserved the saved model/voice selection. Deleting the model
  made its remaining sample unavailable.
- All 20 CLI tests and 19 server speech/management tests passed, including
  unauthenticated/non-admin/incorrect-scope denials, multipart byte preservation,
  URL encoding, file-size validation, and old-server capability detection. CLI
  and server builds and workspace lint passed. No additional migration is needed.

## Configurable input limits follow-up

Speech model character and token limits now accept positive safe integers instead
of imposing the preset's 4,096-character ceiling, a 32,000-token ceiling, or a
64-unit minimum. The preset remains unchanged. Both clients split at the smaller
of the model limits and the API's 16,384 UTF-16-code-unit input bound, preserving
Unicode code points. The route's byte allowance accommodates JSON escaping of all
bounded request fields. The 4,096-code-unit instructions limit remains shared
between preferences, generation requests, and web/mobile inputs.

Regression coverage includes saving 100,000-character/64,000-token models through
the admin editor and CLI, readable validation errors and correction, large ASCII,
emoji, CJK and escaped-control chunks, real Fastify request parsing with a mocked
provider, and usable one-to-three-byte remaining token budgets. Chunk construction
also avoids repeatedly copying the entire remaining message.

Validation: 67 targeted tests passed across contracts, client core, CLI, server,
web and mobile; three database-backed billing tests were skipped. Contracts,
client core, CLI, web and server builds, mobile typecheck, and workspace lint
passed. Web tests on Node 26 used `NODE_OPTIONS=--no-experimental-webstorage` so
jsdom supplies localStorage. No external speech generation or physical-device
playback was performed for this follow-up.

## Validation limits

The browser automation runtime does not mark a page hidden when another automated tab becomes active. Dispatching a visibility change with a hidden document stopped playback, but actual browser backgrounding remains a manual check. Native lifecycle/component tests passed; physical iOS/Android locking, native dictation interaction, and real external speech provider synthesis were not exercised in this run.

Raw screenshots, browser logs, fixture audio, test credentials, and the disposable environment are excluded from version control.
