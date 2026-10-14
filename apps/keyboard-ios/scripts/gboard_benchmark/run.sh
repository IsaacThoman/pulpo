#!/bin/bash
# Build and run an isolated native input harness; artifacts stay outside the repo.
set -euo pipefail
TASK_DEVICE=${1:?Usage: run.sh emulator-PORT corpus-directory [output-directory] [mode]}
TASK_CORPUS=$(cd "${2:?Pass the directory exported by PK_QUALITY_REPORT}" && pwd)
TASK_OUTPUT=${3:-$(mktemp -d /tmp/pulpo-gboard.XXXXXX)}
TASK_MODE=${4:-swipes}
TASK_SOURCE=$(cd "$(dirname "$0")" && pwd)
TASK_SDK=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}
TASK_BT="$TASK_SDK/build-tools/${PK_ANDROID_BUILD_TOOLS:-36.0.0}"
TASK_PLATFORM="$TASK_SDK/platforms/android-36/android.jar"
case "$TASK_DEVICE" in emulator-*) ;; *) echo 'This harness requires an Android emulator.' >&2; exit 1 ;; esac
mkdir -p "$TASK_OUTPUT/classes" "$TASK_OUTPUT/dex" "$TASK_OUTPUT/assets"
if [ "$TASK_MODE" = recordedSwipes ]; then
  python3 "$TASK_SOURCE/prepare_paths.py" --timing recorded "$TASK_CORPUS/comparison-paths.json" "$TASK_OUTPUT/replay-paths.json"
else
  python3 "$TASK_SOURCE/prepare_paths.py" "$TASK_CORPUS/comparison-paths.json" "$TASK_OUTPUT/replay-paths.json"
fi
cp "$TASK_OUTPUT/replay-paths.json" "$TASK_OUTPUT/assets/swipes.json"
cp "$TASK_CORPUS/comparison-cases.json" "$TASK_OUTPUT/assets/cases.json"
javac --release 17 -classpath "$TASK_PLATFORM" -d "$TASK_OUTPUT/classes" "$TASK_SOURCE"/*.java
"$TASK_BT/d8" --lib "$TASK_PLATFORM" --output "$TASK_OUTPUT/dex" "$TASK_OUTPUT"/classes/com/pulpo/keyboardaudit/*.class
"$TASK_BT/aapt2" link -I "$TASK_PLATFORM" --manifest "$TASK_SOURCE/AndroidManifest.xml" -A "$TASK_OUTPUT/assets" -o "$TASK_OUTPUT/unsigned.apk"
(cd "$TASK_OUTPUT" && zip -qj unsigned.apk dex/classes.dex)
if [ ! -f "$TASK_OUTPUT/test.keystore" ]; then
  keytool -genkeypair -keystore "$TASK_OUTPUT/test.keystore" -storepass android -keypass android -alias audit -keyalg RSA -dname 'CN=Keyboard Audit' -validity 30 >/dev/null 2>&1
fi
"$TASK_BT/apksigner" sign --ks "$TASK_OUTPUT/test.keystore" --ks-pass pass:android --out "$TASK_OUTPUT/audit.apk" "$TASK_OUTPUT/unsigned.apk"
# This package belongs only to this harness; Gboard and Pulpo are never removed.
adb -s "$TASK_DEVICE" uninstall com.pulpo.keyboardaudit >/dev/null 2>&1 || true
adb -s "$TASK_DEVICE" install "$TASK_OUTPUT/audit.apk"
adb -s "$TASK_DEVICE" shell dumpsys package com.google.android.inputmethod.latin | rg 'versionName|versionCode' > "$TASK_OUTPUT/gboard-version.txt"
TASK_WINDOW_SCALE=$(adb -s "$TASK_DEVICE" shell settings get global window_animation_scale | tr -d '\r')
TASK_TRANSITION_SCALE=$(adb -s "$TASK_DEVICE" shell settings get global transition_animation_scale | tr -d '\r')
TASK_ANIMATOR_SCALE=$(adb -s "$TASK_DEVICE" shell settings get global animator_duration_scale | tr -d '\r')
restore_animations() {
  adb -s "$TASK_DEVICE" shell settings put global window_animation_scale "$TASK_WINDOW_SCALE"
  adb -s "$TASK_DEVICE" shell settings put global transition_animation_scale "$TASK_TRANSITION_SCALE"
  adb -s "$TASK_DEVICE" shell settings put global animator_duration_scale "$TASK_ANIMATOR_SCALE"
}
trap restore_animations EXIT
adb -s "$TASK_DEVICE" shell settings put global window_animation_scale 0
adb -s "$TASK_DEVICE" shell settings put global transition_animation_scale 0
adb -s "$TASK_DEVICE" shell settings put global animator_duration_scale 0
adb -s "$TASK_DEVICE" shell am instrument --no-hidden-api-checks -w -e mode "$TASK_MODE" -e maxCases "${PK_BENCH_MAX_CASES:-100000}" com.pulpo.keyboardaudit/.AuditRunner | tee "$TASK_OUTPUT/$TASK_MODE.log"
if rg -q 'Exception|Injection rejected|Error:' "$TASK_OUTPUT/$TASK_MODE.log"; then exit 1; fi
if [ "$TASK_MODE" != probe ]; then
  adb -s "$TASK_DEVICE" exec-out run-as com.pulpo.keyboardaudit cat "files/$TASK_MODE.json" > "$TASK_OUTPUT/gboard-$TASK_MODE.json"
fi
echo "Benchmark artifacts: $TASK_OUTPUT"
