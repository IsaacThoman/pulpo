# Pulpo for Apple TV

A native SwiftUI app for tvOS 26 and later. It talks to any Pulpo server
through the same HTTP and Socket.IO APIs as the mobile app, so it needs no
server changes.

## Features

- **Sign in** with email and password (including two-factor codes), to
  pulpo.baby or any self-hosted instance. The fields support typing from a
  nearby iPhone, and password AutoFill for pulpo.baby.
- **Home**: a greeting, a New Chat card, the server's suggested prompts, then
  pinned and recent chats as cards headed by their generated emoji. Folder
  filters appear when the account has folders.
- **Conversations** stream live over the realtime connection, with Markdown,
  syntax-colored code, tables, and formulas (LaTeX is rendered as Unicode
  math). Long replies are split into screen-sized pieces so the remote scrolls
  through them one focus step at a time.
- **Reply actions** (select a reply): read aloud, show thinking and tool steps,
  regenerate, and switch between versions. Select your own message to edit it.
- **Read aloud** with the Apple TV's voices: ⏯ reads the latest reply.
- **Model picker**, favorites first; set the account default from Settings or by
  long-pressing a model.
- **Search** across every chat's messages with the tvOS search keyboard.
- **Chat options**: pin, rename, and delete from a card's context menu (press
  and hold) or the ⋯ button in a conversation.
- Follows the system's light or dark appearance.

## Requirements

Xcode 26 or later with a tvOS simulator runtime, and
[XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).

## Commands

From the repository root:

| Command | |
| --- | --- |
| `npm run tv:demo` | Run in a simulator against the built-in mock server, already signed in. |
| `npm run tv:simulator` | Run in a simulator. Sign in to pulpo.baby or choose **Use a Different Server**; debug builds also accept `http://localhost`. |
| `npm run tv:test` | PulpoKit tests, then the app's unit and Siri Remote UI tests in a simulator. |
| `npm run tv:build` | Build for the simulator. |
| `npm run tv:project` | Generate `apps/tv/PulpoTV.xcodeproj` to work in Xcode. The project is generated, not checked in. |
| `npm run tv:assets` | Re-render the icons and Top Shelf images (needs Blender and `brew install librsvg`). |

`PULPO_TV_SIMULATOR` picks a simulator by name or UDID; by default the newest
Apple TV 4K simulator is used, and one is created if needed.

To develop against the local stack (`npm run local:preview:reset`), choose
**Use a Different Server** and enter `http://localhost:8080`, or launch with
`-PulpoServer http://localhost:8080` to make it the default.

## Layout

```
apps/tv
├── PulpoKit/          Swift package: networking, models, realtime, Markdown (no UI)
├── PulpoTV/           The app
│   ├── App/           Entry point, session and environment
│   ├── Library/       Chats, models, and settings for the account
│   ├── Home/ Search/ Settings/ SignIn/
│   ├── Conversation/  Transcript, Markdown rendering, composer, model picker
│   ├── Design/        Theme and shared components
│   ├── Speech/        Read aloud
│   └── Mock/          In-process mock server (debug builds only)
├── PulpoTVTests/      App model tests
├── PulpoTVUITests/    Siri Remote UI tests
├── scripts/           tv.sh, asset generation
└── project.yml        XcodeGen spec
```

**PulpoKit** builds for macOS as well, so `swift test --package-path
apps/tv/PulpoKit` runs its tests without a simulator. Key pieces:

- `ResponseReducer` is a port of `applyResponseEventToSnapshot` and
  `mergeResponseSnapshots` from `packages/contracts`, and its tests mirror the
  TypeScript ones. Keep the two in step.
- `SocketIOClient` is a small websocket-only Socket.IO v4 client. It reconnects
  with backoff, and each subscription replays the events after its cursor.
- `Markdown`, `ReplySegments`, `SyntaxHighlighter`, and `MathText` parse and
  prepare replies for the screen, including half-finished ones mid-stream.

The session token is kept in this device's keychain only. Requests never send
cookies, and redirects that leave the server's origin are refused so the token
is never forwarded. Attachment downloads from presigned storage URLs are made
without the token.

## Testing

`npm run tv:test` covers PulpoKit (decoding against captured server responses,
the reducer, Socket.IO framing, Markdown, math, and the HTTP client through a
stubbed `URLProtocol`), the app's models against the mock server (sign-in with
two-factor, session expiry, streaming, stopping, regenerating, editing, failed
sends), and UI flows driven by remote presses.

Live checks run PulpoKit against a real server. With the local stack running:

```sh
PULPO_TV_LIVE_SERVER=http://localhost:8080 PULPO_TV_LIVE_TOKEN=<session token> swift test --package-path apps/tv/PulpoKit --filter LiveServer
```

They stream a real reply and check it matches what the server stored, then
delete the chat.

For exploratory testing in a streamed simulator (which has no remote of its
own), `PulpoTVUITests/RemoteControlAgent.swift` turns a UI test into a remote
you drive from a shell; its comment describes the commands.

### Mock server

`-PulpoMock` runs the app against an in-process server with seeded chats and
three models. Replies stream word by word over a simulated realtime
connection. Add `-PulpoSignedIn` to skip sign-in, `-PulpoMockFast` to
stream quickly, and `-PulpoMockLowBalance` to make the first new chat fail as
it would on an account without credit. To sign in, use `ada@pulpo.test` /
`pulpo-tv`, or `grace@pulpo.test` / `pulpo-tv` with the two-factor code
`123456`; `pat@pulpo.test` / `pulpo-tv` is awaiting approval.
`-PulpoAppearance light` or `dark` overrides the system appearance in debug
builds (the simulator can't change it).

## Releasing

The app uses the iOS app's bundle identifier (`com.isaacthoman.pulpo`) so one
App Store record covers both platforms, and the existing
`webcredentials` association lets AutoFill offer pulpo.baby passwords. Before
the first upload, add tvOS to the app in App Store Connect and enable Associated
Domains for the identifier. Archive from Xcode after `npm run tv:project`.
