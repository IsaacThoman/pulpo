#!/usr/bin/env bash
set -euo pipefail
app_root="$(cd "$(dirname "$0")/.." && pwd)"
mode="${1:-run}"
case "$mode" in build|run|test) ;; *) echo 'Usage: tv.sh build|run|test' >&2; exit 2 ;; esac
command -v xcodegen >/dev/null || { echo 'Install XcodeGen: brew install xcodegen' >&2; exit 1; }
xcodegen generate --spec "$app_root/project.yml"
# Keep Swift package resolution reproducible when regenerating the project.
mkdir -p "$app_root/PulpoTV.xcodeproj/project.xcworkspace/xcshareddata/swiftpm"
cp "$app_root/Package.resolved" "$app_root/PulpoTV.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved"
derived="${PULPO_TV_DERIVED_DATA:-$app_root/.build/DerivedData}"
if [[ "$mode" == build ]]; then
  xcodebuild -project "$app_root/PulpoTV.xcodeproj" -scheme PulpoTV -configuration Release \
    -destination 'generic/platform=tvOS Simulator' -derivedDataPath "$derived" CODE_SIGN_IDENTITY=- build
  exit
fi
simulator="${PULPO_TV_SIMULATOR_ID:-}"
if [[ -z "$simulator" ]]; then
  simulator="$(xcrun simctl list devices available --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next((v["udid"] for k,vs in d["devices"].items() if "tvOS" in k for v in vs if v["name"]=="Pulpo TV"), ""))')"
fi
if [[ -z "$simulator" ]]; then
  runtime="$(xcrun simctl list runtimes --json | python3 -c 'import json,sys; r=[v for v in json.load(sys.stdin)["runtimes"] if v["isAvailable"] and "tvOS" in v["identifier"]]; print(sorted(r,key=lambda v:tuple(map(int,v["version"].split("."))))[-1]["identifier"] if r else "")')"
  [[ -n "$runtime" ]] || { echo 'Install a tvOS 26 simulator runtime in Xcode.' >&2; exit 1; }
  simulator="$(xcrun simctl create 'Pulpo TV' com.apple.CoreSimulator.SimDeviceType.Apple-TV-4K-3rd-generation-1080p "$runtime")"
fi
if ! xcrun simctl list devices booted --json | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if any(v["udid"]==sys.argv[1] for vs in d["devices"].values() for v in vs) else 1)' "$simulator"; then
  xcrun simctl boot "$simulator"
fi
xcrun simctl bootstatus "$simulator" -b
destination="platform=tvOS Simulator,id=$simulator"
if [[ "$mode" == test ]]; then
  # Refuse to reuse an unknown service or interfere with another test run.
  node -e 'const s=require("net").createServer();s.on("error",()=>{console.error("Port 8371 is in use. Stop the TV fixture before running tests.");process.exit(1)});s.listen(8371,"127.0.0.1",()=>s.close())'
  mkdir -p "$app_root/.build/evidence"
  node "$app_root/qa/fixture.mjs" > "$app_root/.build/fixture.log" 2>&1 &
  fixture_pid=$!
  trap 'kill "$fixture_pid" 2>/dev/null || true' EXIT
  node -e 'let n=0;async function check(){try{const r=await fetch("http://127.0.0.1:8371/__control");if(!r.ok)throw Error()}catch(e){if(++n>50){console.error("Fixture did not start");process.exit(1)}setTimeout(check,100)}}check()'
  result="$app_root/.build/evidence/$(date +%Y%m%d-%H%M%S).xcresult"
  xcodebuild -project "$app_root/PulpoTV.xcodeproj" -scheme PulpoTV -destination "$destination" \
    -derivedDataPath "$derived" -resultBundlePath "$result" -parallel-testing-enabled NO CODE_SIGN_IDENTITY=- test
else
  xcodebuild -project "$app_root/PulpoTV.xcodeproj" -scheme PulpoTV -destination "$destination" \
    -derivedDataPath "$derived" CODE_SIGN_IDENTITY=- build
  xcrun simctl install "$simulator" "$derived/Build/Products/Debug-appletvsimulator/Pulpo.app"
  open -a Simulator --args -CurrentDeviceUDID "$simulator"
  xcrun simctl launch "$simulator" com.isaacthoman.pulpo
fi
