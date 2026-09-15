# Pulpo for Apple TV

A native SwiftUI client for tvOS 26. Its persistent sidebar follows the iPad
layout, with television-sized text, focus highlights, native text entry, and
Siri Remote navigation. It uses the existing Pulpo HTTP and Socket.IO APIs;
no server deployment or changes to the mobile build are required.

## Run

Install Xcode with a tvOS 26 simulator runtime, Node.js, and XcodeGen
(`brew install xcodegen`). From the repository root:

```sh
npm ci
npm run tv:simulator
```

This generates `apps/tv/PulpoTV.xcodeproj`, creates a dedicated **Pulpo TV**
simulator if needed, builds, installs, and opens the app. Sign in to
`pulpo.baby`, or select the server address to connect to another instance.
Production builds accept HTTPS origins. Debug builds also accept loopback HTTP.

```sh
npm run tv:build        # Release build for the simulator
npm run tv:test         # Native unit, HTTP/realtime integration, and remote UI tests
```

`PULPO_TV_SIMULATOR_ID` selects an existing simulator;
`PULPO_TV_DERIVED_DATA` selects a build directory. The generated project can
also be opened in Xcode to build/archive for an Apple TV. The bundle identifier
matches the iOS app. Signing and App Store distribution are separate from
simulator validation.

## Use

- Move between the sidebar, conversation, and composer with the directional pad.
- Select a chat to open it. Select **Message** to use the system keyboard,
  including the system's paired-device text entry.
- Select the model in the toolbar to change it. The sliders button contains
  model presets and Agent mode when the server/model supports it.
- Select a message or its **…** button for regeneration, editing, branches,
  reasoning, and tool activity. Long responses have multiple focusable sections.
- While a response runs, **Stop** cancels it and **Send** queues the next message.
- **…** in the toolbar contains rename, pin, folder, duplicate, share, and delete.
  Sharing displays a QR code for the public link.
- Back closes a panel or returns focus to **New chat**. Back again leaves the app.

## Implementation

`Sources/Core` owns transport, session storage, response projection, and drafts.
`Sources/App` owns the native interface and observable state. `project.yml` and
`Package.resolved` are the reproducible project/package inputs. The icon and
Top Shelf assets reuse the mobile artwork; regenerate them with
`swift apps/tv/scripts/generate-icons.swift apps/tv` from the repository root.

The bearer token is stored in the device-only Keychain. Authenticated requests
reject cross-origin URLs and redirects. Presigned file URLs are downloaded
without the Pulpo token. Drafts and unconfirmed submissions are scoped by server
and account in the purgeable tvOS cache, and cleared on sign-out. Temporary
chats never write drafts to disk. Failed message acknowledgements retain the
same request UUID/body for an explicit idempotent retry.

Socket.IO invalidations refresh the active conversation and library. Foreground
polling repairs missed events and expired sessions. Network work stops in the
background. Compact responses are projected along the active branch, including
servers that return inactive branch stubs.

## TV scope

Supported: password/2FA sign-in and account creation, custom instances, history,
full-text search, folders, models/presets, Agent mode, temporary chats, sending,
streaming, queue removal, cancellation, regeneration, message editing, branches,
chat management, trash/restore, public sharing, image/text previews, appearance,
account profile, password changes, account deletion, devices, and sign-out.

Camera/photo/document uploads, recording audio, file export, browser-based
passkeys, billing, and administrator tools remain in the phone/web clients.
Other attachment types show their filename and can be opened there. Siri
microphone input and paired-iPhone keyboard entry depend on system/hardware
support and require physical-device validation. The TV app does not implement
the mobile offline outbox or cross-device composer synchronization.

## Tests

`tv:test` starts a disposable loopback fixture on port 8371, runs XCTest on tvOS,
and stops the fixture. It refuses to reuse an occupied port. The fixture uses
the real client transport and Socket.IO connection, deterministic responses,
and the current server request/response shapes. It tests failure injection
without a production account or paid provider calls. This is client integration
coverage; it does not replace server integration tests against Postgres/Redis.

Builds, `.xcresult` bundles, videos, and screenshots stay in ignored `.build/`.
See [validation](qa/validation.md) for the executed simulator coverage.
