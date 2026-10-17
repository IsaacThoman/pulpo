#!/bin/bash
set -euo pipefail
OUT=${1:?Pass external artifact directory}
SOURCE=$(cd "$(dirname "$0")" && pwd)
SDK=${ANDROID_SDK_ROOT:-/Users/isaacthoman/Library/Android/sdk}
export JAVA_HOME=${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}
export PATH="$JAVA_HOME/bin:$SDK/platform-tools:$PATH"
BT="$SDK/build-tools/36.0.0"
PLATFORM="$SDK/platforms/android-36/android.jar"
mkdir -p "$OUT/classes" "$OUT/dex" "$OUT/assets"
cp "$SOURCE/cases.json" "$OUT/assets/multilingual-cases.json"
cp "$OUT/geometry.json" "$OUT/assets/geometry.json"
javac --release 17 -classpath "$PLATFORM" -d "$OUT/classes" "$SOURCE/../../scripts/gboard_benchmark/AuditActivity.java" "$SOURCE/../../scripts/gboard_benchmark/AuditRunner.java" "$SOURCE"/*.java
"$BT/d8" --lib "$PLATFORM" --output "$OUT/dex" "$OUT"/classes/com/pulpo/keyboardaudit/*.class
cat > "$OUT/AndroidManifest.xml" <<'XML'
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.pulpo.multilingualaudit"><uses-sdk android:minSdkVersion="26" android:targetSdkVersion="35"/><application android:theme="@android:style/Theme.Material.Light.NoActionBar" android:label="Multilingual Keyboard Audit" android:debuggable="true"><activity android:name="com.pulpo.keyboardaudit.MultilingualActivity" android:exported="true" android:windowSoftInputMode="stateAlwaysVisible|adjustResize"/></application><instrumentation android:name="com.pulpo.keyboardaudit.MultilingualRunner" android:targetPackage="com.pulpo.multilingualaudit"/></manifest>
XML
"$BT/aapt2" link -I "$PLATFORM" --manifest "$OUT/AndroidManifest.xml" -A "$OUT/assets" -o "$OUT/unsigned.apk"
(cd "$OUT" && zip -qj unsigned.apk dex/classes.dex)
if [ ! -f "$OUT/test.keystore" ];then keytool -genkeypair -keystore "$OUT/test.keystore" -storepass android -keypass android -alias audit -keyalg RSA -dname 'CN=Multilingual Audit' -validity 30 >"$OUT/keytool.txt" 2>&1;fi
"$BT/apksigner" sign --ks "$OUT/test.keystore" --ks-pass pass:android --out "$OUT/audit.apk" "$OUT/unsigned.apk"
adb -s emulator-5554 install -r "$OUT/audit.apk"
