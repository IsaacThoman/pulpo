#!/usr/bin/env bash
# Builds, tests, and runs the Apple TV app. Usage:
#
#   apps/tv/scripts/tv.sh project     Generate PulpoTV.xcodeproj (XcodeGen)
#   apps/tv/scripts/tv.sh build       Build for the tvOS simulator
#   apps/tv/scripts/tv.sh test        PulpoKit tests, then app unit and UI tests in a simulator
#   apps/tv/scripts/tv.sh run [args]  Build, install, and launch in a simulator
#                                     (e.g. `run -PulpoMock -PulpoSignedIn` for the offline demo)
#   apps/tv/scripts/tv.sh assets      Re-render the smiley and regenerate the asset catalog
#
# Environment:
#   PULPO_TV_SIMULATOR        Simulator name or UDID (default: newest Apple TV 4K simulator)
#   PULPO_TV_DERIVED_DATA     Build directory (default: apps/tv/build)
#   PULPO_TV_XCODEBUILD_FLAGS Extra xcodebuild arguments, e.g. CODE_SIGNING_ALLOWED=NO

set -euo pipefail

readonly tv_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly repository_root="$(cd "${tv_directory}/../.." && pwd)"
readonly derived_data="${PULPO_TV_DERIVED_DATA:-${tv_directory}/build}"
readonly project="${tv_directory}/PulpoTV.xcodeproj"
read -r -a extra_flags <<< "${PULPO_TV_XCODEBUILD_FLAGS:-}"

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "$1 is required. $2" >&2
    exit 1
  }
}

generate_project() {
  require xcodegen 'Install it with `brew install xcodegen`.'
  (cd "${tv_directory}" && xcodegen generate --quiet)
}

simulator_id() {
  local wanted="${PULPO_TV_SIMULATOR:-}"
  if [[ "${wanted}" =~ ^[0-9A-F-]{36}$ ]]; then
    echo "${wanted}"
    return
  fi
  local name="${wanted:-Apple TV 4K (3rd generation)}"
  # `simctl` lists runtimes oldest first; take the newest matching device.
  local id
  id="$(xcrun simctl list devices available | grep -F "    ${name} (" | grep -v '(at 1080p)' | tail -1 | grep -oE '[0-9A-F]{8}-[0-9A-F-]{27}' || true)"
  if [[ -z "${id}" ]]; then
    local runtime
    runtime="$(xcrun simctl list runtimes available | grep -oE 'com\.apple\.CoreSimulator\.SimRuntime\.tvOS-[0-9-]+' | tail -1 || true)"
    [[ -n "${runtime}" ]] || { echo 'No tvOS simulator runtime is installed (Xcode → Settings → Components).' >&2; exit 1; }
    id="$(xcrun simctl create "${name}" 'com.apple.CoreSimulator.SimDeviceType.Apple-TV-4K-3rd-generation-4K' "${runtime}")"
  fi
  echo "${id}"
}

xcodebuild_app() {
  local action="$1"
  shift
  xcodebuild \
    -project "${project}" \
    -scheme PulpoTV \
    -destination "id=$(simulator_id)" \
    -derivedDataPath "${derived_data}" \
    ${extra_flags[@]+"${extra_flags[@]}"} \
    "$@" \
    "${action}"
}

case "${1:-}" in
  project)
    generate_project
    echo "Generated ${project}"
    ;;
  build)
    generate_project
    xcodebuild_app build -quiet
    ;;
  test)
    generate_project
    swift test --package-path "${tv_directory}/PulpoKit"
    xcodebuild_app test -quiet -parallel-testing-enabled NO -only-testing:PulpoTVTests -only-testing:PulpoTVUITests/PulpoTVUITests
    ;;
  run)
    shift
    generate_project
    simulator="$(simulator_id)"
    xcodebuild_app build -quiet
    xcrun simctl boot "${simulator}" 2>/dev/null || true
    open -a Simulator --args -CurrentDeviceUDID "${simulator}"
    xcrun simctl install "${simulator}" "${derived_data}/Build/Products/Debug-appletvsimulator/Pulpo.app"
    xcrun simctl launch "${simulator}" com.isaacthoman.pulpo "$@"
    ;;
  assets)
    require blender 'Install Blender to re-render the smiley.'
    require rsvg-convert 'Install it with `brew install librsvg`.'
    renders="$(mktemp -d)"
    trap 'rm -rf "${renders}"' EXIT
    blender -b "${repository_root}/assets/smiley.blend" --python "${tv_directory}/scripts/render-smiley.py" -- "${renders}" >/dev/null
    (cd "${repository_root}" && swift apps/tv/scripts/generate-assets.swift "${renders}")
    ;;
  *)
    sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
