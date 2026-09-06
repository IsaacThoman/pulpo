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

## GitHub Actions releases

Both platforms build directly on GitHub runners using Expo prebuild and the
native toolchain. No Expo account, EAS project, or Expo cloud build is needed.
The bundle/package identifier is `com.isaacthoman.pulpo`.

The `testflight` job in `.github/workflows/release.yml` builds the semantic
release tag with Xcode and uploads it to TestFlight using the `testflight`
GitHub environment. Its Apple team is `PX72AL9366`. App Store metadata is
versioned in `store.config.json`; credentials belong in GitHub secrets.

### Android signing setup

Create a GitHub environment named `google-play` under repository Settings →
Environments. Add these environment secrets:

| Secret | Value |
| --- | --- |
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | Base64-encoded Android upload keystore |
| `ANDROID_UPLOAD_STORE_PASSWORD` | Keystore password |
| `ANDROID_UPLOAD_KEY_ALIAS` | Upload key alias, such as `pulpo-upload` |
| `ANDROID_UPLOAD_KEY_PASSWORD` | Password for that key |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Google service account JSON key; only needed for automatic uploads |

If no upload key has been registered for this app, generate one outside the
repository with JDK 21's `keytool`. If a key is already registered, reuse it.
Keep a secure backup of the keystore and passwords.

```bash
mkdir -p "$HOME/.pulpo-signing"
chmod 700 "$HOME/.pulpo-signing"
keytool -genkeypair -v -storetype JKS \
  -keystore "$HOME/.pulpo-signing/upload.keystore" \
  -alias pulpo-upload -keyalg RSA -keysize 3072 -validity 10000
chmod 600 "$HOME/.pulpo-signing/upload.keystore"
base64 < "$HOME/.pulpo-signing/upload.keystore" | \
  gh secret set ANDROID_UPLOAD_KEYSTORE_BASE64 --env google-play --repo IsaacThoman/pulpo
```

Set the other secrets in GitHub's UI or with `gh secret set NAME --env
google-play --repo IsaacThoman/pulpo`, which prompts for the value. Do not commit
keys, passwords, or service account JSON to the repository.

### First Play Store bundle

After the workflow is merged, open Actions → **Android release** → **Run
workflow**. Select the branch or tag to build, enter its app version, and leave
**Upload to Google Play internal testing** unchecked. The workflow installs
JDK 21 / SDK 37, builds the shared packages, prebuilds Android, and runs Gradle
`bundleRelease`. It overrides Expo's debug signing default and verifies the
bundle against the upload certificate before saving the `.aab` artifact.

Download the `Pulpo-<version>-Android-<versionCode>` artifact and upload its
`.aab` to Play Console → Pulpo → Testing → Internal testing. Enroll in Play App
Signing using a Google-generated app-signing key. Finish the first release
setup in Play Console before enabling the API upload action.

The app version comes from the workflow input or semantic release. Version
codes use seconds since January 1, 2024, and are regenerated for reruns. All
Android runs are serialized. If an existing Play upload used a higher version
code, adjust this scheme before uploading; Google requires increasing codes.

### Automatic uploads and releases

Enable the [Google Play Android Developer API](https://developers.google.com/android-publisher/getting_started)
in a Google Cloud project, create a service account and JSON key, then invite
its email through Play Console → Users and permissions. Grant access to Pulpo
with **View app information (read-only)** and **Release apps to testing tracks**.
Store the JSON as `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` in `google-play`.

Run **Android release** from `main` or a release tag with upload checked to
send a new bundle to the `internal` track. When running from a tag, the version
input must match it: tag `v1.2.3` requires version `1.2.3`. Other branches can
build downloadable artifacts with upload unchecked. Keep the manual run's
status `draft` while the app's first release is being set up. Once the app is
ready for tester distribution, use `completed`.
The artifact is saved before upload, so upload failures still leave a
downloadable signed bundle.

Android uses the same automatic trigger as iOS: each new semantic release
from a push to `main` builds that exact tag and uploads to internal testing.
The repository's default branch does not control this trigger, and pushes to
`dev` do not release either mobile app. Configure the `google-play` credentials
before promoting this workflow to `main`.

Automatic releases default to `completed`, making them available to internal
testers. The optional repository variable `ANDROID_RELEASE_STATUS=draft` can
hold automatic uploads as drafts during initial Play setup. Promote a tested
release to closed testing or production in Play Console.

For native Android passkeys, configure the server's
`PULPO_ANDROID_CERTIFICATE_FINGERPRINTS` with the **Play app-signing certificate**
SHA-256 fingerprint, then set `PULPO_ANDROID_PASSKEY_DOMAINS=pulpo.baby` in the
`google-play` environment before building. Verify `assetlinks.json` and test
passkeys and shared links with the Play-installed app. The upload certificate
is a different key. Leaving the domains unset uses browser authentication.
