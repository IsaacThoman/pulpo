#!/usr/bin/env bash
# Archive an iOS app with cloud-managed signing and upload it to TestFlight.
#
# Usage: upload-ios-testflight.sh [--validate COMMAND] -- XCODEBUILD_ARGUMENTS...
#
# XCODEBUILD_ARGUMENTS select the project or workspace and scheme. COMMAND, when
# given, receives the archive path and must succeed before the upload starts.
# Apple credentials are only written to a temporary keychain and key file that
# are removed when the script exits.
set -euo pipefail

readonly team_id="PX72AL9366"

validator=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --validate)
      validator="${2:?--validate requires a command}"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done
if [[ $# -eq 0 ]]; then
  echo 'Pass the xcodebuild project or workspace and scheme after --.' >&2
  exit 2
fi
selection=("$@")

for variable in \
  APP_STORE_CONNECT_API_ISSUER_ID \
  APP_STORE_CONNECT_API_KEY_ID \
  APP_STORE_CONNECT_API_PRIVATE_KEY \
  IOS_DEVELOPMENT_CERTIFICATE_P12_BASE64 \
  IOS_DEVELOPMENT_CERTIFICATE_PASSWORD; do
  if [[ -z "${!variable:-}" ]]; then
    echo "The ${variable} GitHub environment secret is not configured." >&2
    exit 1
  fi
done
: "${PULPO_APP_VERSION:?PULPO_APP_VERSION is required}"
: "${PULPO_IOS_BUILD_NUMBER:?PULPO_IOS_BUILD_NUMBER is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

work_directory="$(mktemp -d "${RUNNER_TEMP}/ios-testflight.XXXXXX")"
auth_key_path="${work_directory}/AuthKey_${APP_STORE_CONNECT_API_KEY_ID}.p8"
certificate_path="${work_directory}/Pulpo-CI.p12"
keychain_path="${work_directory}/pulpo-signing.keychain-db"
keychain_password="$(openssl rand -base64 32)"
trap 'security delete-keychain "${keychain_path}" 2>/dev/null || true; rm -rf "${work_directory}"' EXIT

printf '%s' "${APP_STORE_CONNECT_API_PRIVATE_KEY}" > "${auth_key_path}"
printf '%s' "${IOS_DEVELOPMENT_CERTIFICATE_P12_BASE64}" | base64 --decode > "${certificate_path}"
chmod 600 "${auth_key_path}"
chmod 600 "${certificate_path}"

echo 'Creating temporary signing keychain.'
security create-keychain -p "${keychain_password}" "${keychain_path}"
security set-keychain-settings -lut 21600 "${keychain_path}"
security unlock-keychain -p "${keychain_password}" "${keychain_path}"

echo 'Importing Apple Development signing identity.'
security import "${certificate_path}" \
  -k "${keychain_path}" \
  -P "${IOS_DEVELOPMENT_CERTIFICATE_PASSWORD}" \
  -A \
  -t cert \
  -f pkcs12

if ! security find-identity -v -p codesigning "${keychain_path}" | grep -q 'Apple Development'; then
  echo 'The imported PKCS#12 does not contain a valid Apple Development signing identity and private key.' >&2
  exit 1
fi

echo 'Configuring signing identity key access.'
security set-key-partition-list \
  -S apple-tool:,apple: \
  -k "${keychain_password}" \
  "${keychain_path}"
security list-keychains -d user -s "${keychain_path}"
security default-keychain -d user -s "${keychain_path}"

archive_path="${work_directory}/App.xcarchive"
export_options_path="${work_directory}/ExportOptions.plist"
authentication=(
  -allowProvisioningUpdates
  -authenticationKeyPath "${auth_key_path}"
  -authenticationKeyID "${APP_STORE_CONNECT_API_KEY_ID}"
  -authenticationKeyIssuerID "${APP_STORE_CONNECT_API_ISSUER_ID}"
)

echo "Uploading ${PULPO_APP_VERSION} (${PULPO_IOS_BUILD_NUMBER}) to TestFlight."

xcodebuild \
  "${selection[@]}" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "${archive_path}" \
  "${authentication[@]}" \
  DEVELOPMENT_TEAM="${team_id}" \
  MARKETING_VERSION="${PULPO_APP_VERSION}" \
  CURRENT_PROJECT_VERSION="${PULPO_IOS_BUILD_NUMBER}" \
  archive

if [[ -n "${validator}" ]]; then
  echo 'Validating the archive before upload.'
  "${validator}" "${archive_path}"
fi

cat > "${export_options_path}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>destination</key>
  <string>upload</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>teamID</key>
  <string>${team_id}</string>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
  <key>testFlightInternalTestingOnly</key>
  <false/>
</dict>
</plist>
PLIST

xcodebuild \
  -exportArchive \
  -archivePath "${archive_path}" \
  -exportOptionsPlist "${export_options_path}" \
  "${authentication[@]}"
