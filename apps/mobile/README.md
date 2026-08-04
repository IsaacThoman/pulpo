# Pulpo for iPhone

Pulpo Mobile is the iOS 26 member client for a Pulpo instance. It uses Expo SDK
57, Expo Router, React Native 0.86, SwiftUI-backed controls from `@expo/ui`,
Liquid Glass, TanStack Query, Zustand, SQLite, SecureStore, FileSystem, and
Socket.IO.

Generated `ios/` and `android/` projects are intentionally ignored. Continuous
Native Generation recreates them from `app.config.ts` and the installed config
plugins.

## Local development

From the repository root, install dependencies and start the supported local
stack:

```bash
npm install
docker compose up --build -d
EXPO_PUBLIC_DEFAULT_INSTANCE_URL=http://localhost:8080 npm run dev:mobile
```

Choose an iOS 26 simulator from Expo CLI. The iOS simulator reaches the host's
Compose gateway through `localhost`. The development build permits local HTTP;
production instance switching accepts HTTPS only.

Only the bearer session token is placed in iOS Keychain through SecureStore.
The active instance, preferences, cached queries, drafts, cursors, search index,
outbox, and attachment metadata are stored in namespaced SQLite tables. Cached
attachment bytes use the app cache and are evicted by the configured LRU quota.

## Configuration and validation

`EXPO_PUBLIC_DEFAULT_INSTANCE_URL` is compiled into the client. It is public
configuration, never a secret. Copy `.env.example` to `.env.local` when a
persistent local override is useful.

```bash
npm run mobile:typecheck
npm test -w @pulpo/mobile
npm run mobile:export
npx expo-doctor@latest apps/mobile
```

To regenerate native projects for inspection, run `npm run prebuild -w
@pulpo/mobile`. Do not commit the generated directories.

## EAS and TestFlight

The app identity is `isaacthoman/pulpo`, its bundle identifier is
`com.isaacthoman.pulpo`, and its Apple team is `PX72AL9366`.

```bash
cd apps/mobile
npx eas-cli login
npx eas-cli init
npx eas-cli build --platform ios --profile preview
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production
```

`eas-cli init` must be run while signed in to the `isaacthoman` Expo account so
it can write the real EAS project ID. Never substitute another owner or team.
App Store metadata is versioned in `store.config.json`; review credentials and
contact details still belong in protected App Store Connect/EAS configuration,
not source control.
