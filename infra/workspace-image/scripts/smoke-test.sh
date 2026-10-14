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

pulpo files --help | grep -q 'pulpo files pull'
pulpo files push --help | grep -q -- '--force'
if pulpo files ls > /dev/null 2>&1; then
  echo 'FAIL: pulpo files ran outside an agent bash command' >&2
  exit 1
fi

# Run `pulpo files` inside a daemon bash operation and answer its relay request as Pulpo would.
readonly daemon_url='http://127.0.0.1:18787'
readonly daemon_token="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
PORT=18787 PULPO_WORKSPACE_TOKEN="${daemon_token}" PULPO_WORKSPACE_ROOT="${temporary_directory}" \
  PULPO_RELAY_SOCKET="${temporary_directory}/relay.sock" PULPO_WORKSPACE_TOOL_OUTPUT_DIR="${temporary_directory}/tool-output" \
  node /opt/pulpo-workspace-daemon/index.js > "${temporary_directory}/daemon.log" 2>&1 &
readonly daemon_pid=$!
trap 'kill "${daemon_pid}" 2> /dev/null || true; rm -rf "${temporary_directory}"' EXIT
daemon() { curl --silent --show-error --fail-with-body -H "authorization: Bearer ${daemon_token}" -H 'content-type: application/json' "$@"; }
for _ in $(seq 100); do curl --silent --fail "${daemon_url}/healthz" > /dev/null && break; sleep 0.1; done
daemon -X POST "${daemon_url}/v1/operations" -d '{"id":"smoke-relay","type":"bash","args":{"command":"pulpo files cat Notes.md"}}' > /dev/null
request_id=''
for _ in $(seq 20); do
  request_id="$(daemon "${daemon_url}/v1/operations/smoke-relay?waitMs=1000" | jq -r '.relay.pending[0].id // empty')"
  [[ -n "${request_id}" ]] && break
done
if [[ -z "${request_id}" ]]; then
  echo 'FAIL: pulpo files did not reach the daemon relay socket' >&2
  cat "${temporary_directory}/daemon.log" >&2
  exit 1
fi
daemon -X POST "${daemon_url}/v1/relay/${request_id}" -d '{"ok":true,"output":"pulpo-relay-ok"}' > /dev/null
relay_output=''
for _ in $(seq 20); do
  operation="$(daemon "${daemon_url}/v1/operations/smoke-relay?waitMs=1000")"
  if [[ "$(jq -r .status <<< "${operation}")" != running ]]; then relay_output="$(jq -r .output <<< "${operation}")"; break; fi
done
assert_equal pulpo-relay-ok "${relay_output}" 'pulpo files prints the answer relayed by the daemon'

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
