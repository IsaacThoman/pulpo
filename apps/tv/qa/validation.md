# Apple TV validation

Executed on September 15, 2026 with Xcode 26.6 and the tvOS 26.5 simulator.

| Configuration | Result |
| --- | --- |
| Apple TV 4K (3rd generation), 1080p | 29 tests passed, 0 failures |
| Apple TV 4K (3rd generation), 4K | 29 tests passed, 0 failures |
| Release, generic tvOS Simulator (arm64 and x86_64) | Build passed |
| Signed Release, physical Apple TV 4K (3rd generation), tvOS 26.6 | Installed, launched, and confirmed running |

Each simulator run contains 11 core tests, 13 HTTP/Socket.IO integration tests,
and 5 remote UI tests. The integration tests use the disposable local fixture;
they do not connect to a production account or run the server's Postgres/Redis
integration suite. UI tests navigate with `XCUIRemote` and enter text through
the native tvOS keyboard.

## Coverage

| Area | Verified behavior |
| --- | --- |
| Authentication | Password errors, 2FA challenge, successful sign-in, Keychain storage, token expiry/revocation, offline sign-out |
| Transport | HTTPS origins, encoded search queries/resource IDs, cross-origin credential protection, session isolation |
| Conversation | New chat, follow-up, model selection, streaming snapshots, dropped acknowledgement and idempotent retry, failed responses |
| Navigation state | Draft switching, temporary draft isolation, slow requests cannot overwrite a newly selected chat |
| Generation | Model presets, queueing/removal, stop, regeneration, active branches, message editing using the input resource |
| Library | Search, pin/rename/folder/duplicate/delete, trash/restore, folder creation/rename/delete, public-share settings |
| Settings | Appearance, model defaults, profile, device revocation, password errors, deletion confirmation/authentication |
| Rendering | Unknown tool/refusal payloads, inactive branch stubs, full snapshots, long Markdown chunking |
| Remote UI | Sidebar/conversation/composer focus, native keyboard and message submission, models and options, search, folders, trash, sheets and Back |
| Visual review | Dark and light appearance, conversation, settings, sign-in, keyboard, image preview, focus highlights and safe-area spacing |

The image-preview UI test waits for the authenticated image to load. The message
action UI test regenerates a reply and checks that its replacement appears.
The appearance test changes a model preset, verifies that TV settings do not
offer an account-theme override, and opens a conversation after sheet dismissal.
Appearance comes from tvOS; the fixture deliberately retains its account's Dark
theme preference.

## Reproduce

```sh
npm ci
npm run tv:test
npm run tv:build
```

Set `PULPO_TV_SIMULATOR_ID` to repeat on a particular installed simulator.
The commands create ignored `.build/evidence/*.xcresult` bundles with logs,
screenshots, and UI recordings. The initial complete runs are
`20260915-183326.xcresult` (1080p) and `20260915-183626.xcresult` (4K).
Evidence is intentionally excluded from source control.

## System appearance

The native appearance update removes custom background colors, tint, focus
colors, and the shared account theme override. It uses the tvOS backdrop,
standard buttons, and system materials. The complete 29-test suite passed with
the simulator's Dark appearance (`20260915-191617.xcresult`).
After switching to Light in tvOS Settings, the final 29-test suite also passed
(`20260915-192521.xcresult`). Screenshots confirm the system Light appearance
despite the fixture account's saved Dark theme. Native button scaling is included
in the remote test navigation, and the Release build passed with Xcode 27.

## Physical-device deployment

The Release configuration was built with Xcode 26.6 and signed with the team's
Apple Development identity and tvOS provisioning profile. After completing
Xcode 27 setup, `devicectl` installed and launched the app on a paired Apple TV
4K running tvOS 26.6. A subsequent process query confirmed Pulpo remained running.
This verifies installation and launch; it does not establish hardware input or
live-server feature coverage.

## Remaining validation

- A physical Siri Remote microphone and paired-iPhone keyboard require an
  actual Apple TV. Simulator text input passes.
- Production authentication, live model providers, and server persistence need
  a configured instance/account for end-to-end verification.
- App Store signing, archival, and distribution have not been performed.
- Phone/web-only capabilities are listed in the [TV scope](../README.md#tv-scope).

The Apple TV workflow runs simulator tests and the Release build on relevant
pull requests. Its first hosted CI run has not been executed locally.
