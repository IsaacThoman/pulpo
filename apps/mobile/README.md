# Pulpo Mobile

Pulpo Mobile is the iOS 26 and Android member client for a Pulpo instance. It
uses Expo SDK 57, Expo Router, React Native 0.86, TanStack Query, Zustand,
SQLite, SecureStore, FileSystem, and Socket.IO. iOS uses SwiftUI and Liquid
Glass; Android uses Jetpack Compose Material 3 Expressive through `@expo/ui`,
with dynamic system colors and native fields, buttons, switches, contextual menus
and dialogs. Chat history uses the same sliding conversation layout as iOS;
folders expand inline, and model selection opens beneath the toolbar title.

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

Only the bearer session token is placed in platform secure storage through SecureStore.
The active instance, preferences, cached queries, drafts, cursors, search index,
outbox, and attachment metadata are stored in namespaced SQLite tables. Cached
attachment bytes use the app cache and are evicted by the configured LRU quota.

### Android development

Install Android Studio, an Android 17 / API 37 system image, SDK Platform 37,
Build Tools 37.0.0, and JDK 21. Set `ANDROID_HOME` to your Android SDK directory
and `JAVA_HOME` to your JDK. Start an emulator in Android Studio's Device Manager.

```bash
adb reverse tcp:8080 tcp:8080
adb reverse tcp:8081 tcp:8081
EXPO_PUBLIC_DEFAULT_INSTANCE_URL=http://localhost:8080 npm run dev:android
```

The first command forwards the local Pulpo gateway, and the second forwards
Metro. Use the actual server port if your stack runs elsewhere. If Metro does
not connect, set **Debug server host & port for device** in the development
menu to `localhost:8081`, then reload. USB Android devices support the same
forwarding workflow. `10.0.2.2` is also available on standard Android emulators.

The generated project targets API 37 and supports the Expo SDK's minimum
Android version. Material colors follow the wallpaper on Android 12+
and use the bundled Material palette on older versions. The app supports system
Back, edge-to-edge insets, keyboard resizing, rotation, and the existing wide
layout. Files open using a native Android viewer with a temporary read grant;
sharing uses Android's sharesheet with the actual attachment bytes.

Platform UI lives in `src/platform/MaterialUI.android.tsx`. Android-only view
implementations use Metro's `.android.tsx` resolution, leaving the SwiftUI
implementations available to iOS. Keep business logic, server operations, cache,
drafts, and queue state shared between platforms.

## Configuration and validation

`EXPO_PUBLIC_DEFAULT_INSTANCE_URL` is compiled into the client. It is public
configuration, never a secret. Copy `.env.example` to `.env.local` when a
persistent local override is useful.

The build always includes `pulpo.baby` for native passkeys. The HTTPS hostname
from `EXPO_PUBLIC_DEFAULT_INSTANCE_URL` is also included. Add more native
relying-party domains with a comma-separated `PULPO_IOS_PASSKEY_DOMAINS` value
before prebuilding or signing:

```bash
PULPO_IOS_PASSKEY_DOMAINS=chat.example.com,pulpo.company.test npm run prebuild -w @pulpo/mobile
```

This generates matching `webcredentials:` associated-domain entitlements and
exposes the same allow-list to runtime selection. Each domain must serve the
Pulpo AASA document for Apple team `PX72AL9366` and bundle
`com.isaacthoman.pulpo`. Instances not compiled into the app remain supported
through the authorization-code-with-PKCE browser flow. Changing an instance's
canonical `PUBLIC_URL` hostname invalidates passkeys registered for the old
hostname.

### Android passkeys and verified links

Native Android passkeys require the app's real signing certificate and a
verified HTTPS domain. Before building, set `PULPO_ANDROID_PASSKEY_DOMAINS` to
the comma-separated hostnames configured for that signed build. On each server,
set `PULPO_ANDROID_CERTIFICATE_FINGERPRINTS` to the comma-separated SHA-256
certificate fingerprints (colon-separated or plain hex). For Google Play use
the **app signing** certificate, which differs from the upload certificate.

The API and gateway serve `/.well-known/assetlinks.json` for package
`com.isaacthoman.pulpo`. The same certificate allow-list validates Android
Credential Manager origins during native passkey ceremonies; browser passkey
origin checks remain scoped to the HTTPS site. Multiple fingerprints support
certificate rotation. With no configured certificates, the endpoint returns
an empty list and grants no app association.

Unlisted instances use the browser flow with PKCE. The default Android build
has no native-passkey domains until release signing is configured. Local HTTP
fixtures exercise password authentication; they cannot verify production
Credential Manager or HTTPS App Links.

```bash
npm run mobile:typecheck
npm test -w @pulpo/mobile
npm run mobile:export
npx expo-doctor@latest apps/mobile
```

To regenerate native projects for inspection, run `npm run prebuild -w
@pulpo/mobile`. Do not commit the generated directories.

## Quiet device deployment

From the repository root, build, install, and launch an optimized Release build
on Isaac's iPhone with:

```bash
npm run deploy:iphone
```

Routine Expo and Xcode output is written to `/tmp/pulpo-ios-deploy.log`. A
failed deployment prints only the final 80 lines. Override the defaults with
`PULPO_IOS_DEVICE`, `PULPO_INSTANCE_URL`, or `PULPO_IOS_DEPLOY_LOG`.

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

Android uses the same Expo project and package name. Build an installable preview
APK or a production Play Store app bundle with:

```bash
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform android --profile production
```

Configure the real Android signing credentials in EAS/Play Console before
distribution. These commands build artifacts; Play Store publication remains
a separate release step. `PULPO_ANDROID_VERSION_CODE` overrides the local native
version code; EAS production uses its remote incrementing version.

`eas-cli init` must be run while signed in to the `isaacthoman` Expo account so
it can write the real EAS project ID. Never substitute another owner or team.
App Store metadata is versioned in `store.config.json`; review credentials and
contact details still belong in protected App Store Connect/EAS configuration,
not source control.
