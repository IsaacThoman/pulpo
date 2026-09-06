#!/usr/bin/env bash
set -euo pipefail

mobile_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for variable in \
  ANDROID_UPLOAD_KEYSTORE_BASE64 \
  ANDROID_UPLOAD_STORE_PASSWORD \
  ANDROID_UPLOAD_KEY_ALIAS \
  ANDROID_UPLOAD_KEY_PASSWORD; do
  if [[ -z "${!variable:-}" ]]; then
    echo "Configure ${variable} in the google-play GitHub environment." >&2
    exit 1
  fi
done

if [[ ! -f "${mobile_dir}/android/app/build.gradle" ]]; then
  echo 'Generate the Android project with expo prebuild before building the release.' >&2
  exit 1
fi

umask 077
signing_dir="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/pulpo-android-signing.XXXXXX")"
trap 'rm -rf "${signing_dir}"' EXIT
export ANDROID_UPLOAD_KEYSTORE_PATH="${signing_dir}/upload.keystore"
printf '%s' "${ANDROID_UPLOAD_KEYSTORE_BASE64}" | base64 --decode > "${ANDROID_UPLOAD_KEYSTORE_PATH}"
unset ANDROID_UPLOAD_KEYSTORE_BASE64

# Appending this once preserves Expo's generated configuration while overriding
# its default debug signing configuration only for this release build.
signing_line='apply from: "../../scripts/android-release.gradle"'
if ! grep -Fqx "${signing_line}" "${mobile_dir}/android/app/build.gradle"; then
  printf '\n%s\n' "${signing_line}" >> "${mobile_dir}/android/app/build.gradle"
fi

cd "${mobile_dir}/android"
./gradlew :app:bundleRelease --no-daemon --no-configuration-cache --console=plain

bundle_path="${mobile_dir}/android/app/build/outputs/bundle/release/app-release.aab"
test -s "${bundle_path}"
# Android upload certificates are normally self-signed. Compare the signer's
# certificate to the upload key as well as checking the bundle's JAR signature.
LC_ALL=C jarsigner -verify "${bundle_path}" > "${signing_dir}/verification.txt"
if ! grep -q 'jar verified\.' "${signing_dir}/verification.txt"; then
  echo 'The Android app bundle signature could not be verified.' >&2
  exit 1
fi
keytool -exportcert -rfc \
  -keystore "${ANDROID_UPLOAD_KEYSTORE_PATH}" \
  -storepass:env ANDROID_UPLOAD_STORE_PASSWORD \
  -alias "${ANDROID_UPLOAD_KEY_ALIAS}" > "${signing_dir}/expected.pem"
keytool -printcert -rfc -jarfile "${bundle_path}" > "${signing_dir}/actual.pem"
openssl x509 -in "${signing_dir}/expected.pem" -outform DER -out "${signing_dir}/expected.der"
openssl x509 -in "${signing_dir}/actual.pem" -outform DER -out "${signing_dir}/actual.der"
if ! cmp -s "${signing_dir}/expected.der" "${signing_dir}/actual.der"; then
  echo 'The bundle was not signed with the configured Android upload key.' >&2
  exit 1
fi
echo "Verified signed Android bundle: ${bundle_path}"
