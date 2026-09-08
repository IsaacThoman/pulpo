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

## Automated validation

- Shared speech: 7 tests passed.
- Web settings, admin voice editor, and message actions: 45 tests passed.
- Server speech, previews, backup compatibility/projection, and preferences: 37 tests passed.
- Mobile speech settings, playback lifecycle, and preferences: 15 tests passed.
- PostgreSQL speech accounting: 3 tests passed.
- Web production build and workspace lint passed.

## Validation limits

The browser automation runtime does not mark a page hidden when another automated tab becomes active. Dispatching a visibility change with a hidden document stopped playback, but actual browser backgrounding remains a manual check. Native lifecycle/component tests passed; physical iOS/Android locking, native dictation interaction, and real external speech provider synthesis were not exercised in this run.

Raw screenshots, browser logs, fixture audio, test credentials, and the disposable environment are excluded from version control.
