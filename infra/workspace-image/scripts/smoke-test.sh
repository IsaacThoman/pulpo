#!/usr/bin/env bash
set -euo pipefail

readonly minimum_node_major=22
readonly minimum_node_minor=19
readonly temporary_directory="$(mktemp -d)"
trap 'rm -rf "${temporary_directory}"' EXIT

assert_equal() {
  local expected="$1"
  local actual="$2"
  local description="$3"
  if [[ "${actual}" != "${expected}" ]]; then
    printf 'FAIL: %s (expected %q, got %q)\n' "${description}" "${expected}" "${actual}" >&2
    exit 1
  fi
}

assert_equal agent "$(whoami)" 'container runs as agent'
assert_equal root "$(sudo whoami)" 'passwordless sudo reaches root'

workspace_probe="/workspace/.pulpo-write-test-$$"
touch "${workspace_probe}"
rm -f "${workspace_probe}"

node --version
npm --version
python3 --version
# Match the daemon's login-shell execution, not just the Docker environment.
bash -lc 'python /opt/pulpo/package-smoke-test.py'
bash -lc 'python3 -m pip check'
python /opt/pulpo/package-inventory.py > "${temporary_directory}/PACKAGES.md"
cmp /opt/pulpo/PACKAGES.md "${temporary_directory}/PACKAGES.md"

git --version
rg --version | head -n 1
curl --version | head -n 1

# Exercise audio/video encoding, inspection, and decoding without network access.
media_probe="${temporary_directory}/media.mp4"
ffmpeg -nostdin -hide_banner -loglevel error \
  -f lavfi -i 'testsrc=size=64x64:rate=10' \
  -f lavfi -i 'sine=frequency=440:sample_rate=44100' \
  -t 0.5 -c:v libx264 -pix_fmt yuv420p -c:a aac "${media_probe}"
assert_equal h264 "$(ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${media_probe}")" 'FFmpeg encodes H.264 video'
assert_equal aac "$(ffprobe -v error -select_streams a:0 \
  -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${media_probe}")" 'FFmpeg encodes AAC audio'
ffmpeg -nostdin -hide_banner -loglevel error -xerror -i "${media_probe}" -f null -

node -e "
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < ${minimum_node_major} || (major === ${minimum_node_major} && minor < ${minimum_node_minor})) {
    throw new Error('Node.js ' + process.versions.node + ' does not satisfy Pi >=${minimum_node_major}.${minimum_node_minor}.0');
  }
"

git -C "${temporary_directory}" init --quiet
git -C "${temporary_directory}" status --short

printf 'print("pulpo-python-ok")\n' > "${temporary_directory}/smoke.py"
assert_equal pulpo-python-ok "$(python3 "${temporary_directory}/smoke.py")" 'Python executes a script'

if [[ -e /var/run/secrets/kubernetes.io/serviceaccount/token ]]; then
  echo 'FAIL: Kubernetes service-account token is mounted' >&2
  exit 1
fi

readonly forbidden_environment_pattern='^(OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY|AZURE_OPENAI_API_KEY|PULPO_API_KEY|PULPO_MODEL_API_KEY)='
if env | grep -Eq "${forbidden_environment_pattern}"; then
  echo 'FAIL: a Pulpo or model-provider credential variable is present' >&2
  exit 1
fi

echo 'Pulpo workspace smoke test passed.'
