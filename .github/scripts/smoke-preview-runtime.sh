#!/usr/bin/env bash

set -euo pipefail

: "${PREVIEW_URL:?PREVIEW_URL is required}"
: "${PULPO_PREVIEW_SMOKE_EMAIL:?PULPO_PREVIEW_SMOKE_EMAIL is required}"
: "${PULPO_PREVIEW_SMOKE_PASSWORD:?PULPO_PREVIEW_SMOKE_PASSWORD is required}"

cookie_jar="$(mktemp)"
trap 'rm -f "${cookie_jar}"' EXIT

curl --fail --silent --show-error \
  --cookie-jar "${cookie_jar}" \
  --header 'content-type: application/json' \
  --data "$(jq -cn \
    --arg email "${PULPO_PREVIEW_SMOKE_EMAIL}" \
    --arg password "${PULPO_PREVIEW_SMOKE_PASSWORD}" \
    '{email: $email, password: $password}')" \
  "${PREVIEW_URL}/api/auth/login" >/dev/null

new_id() {
  node -e 'console.log(crypto.randomUUID())'
}

start_response() {
  local prompt="$1"
  local agent_mode="$2"
  local chat_id response_id payload result
  chat_id="$(new_id)"
  response_id="$(new_id)"
  payload="$(jq -cn \
    --arg chat_id "${chat_id}" \
    --arg response_id "${response_id}" \
    --arg prompt "${prompt}" \
    --argjson agent_mode "${agent_mode}" \
    '{
      chat: {
        clientId: $chat_id,
        modelId: "gpt-5.6-luna",
        title: "CI preview smoke",
        temporary: true
      },
      response: {
        clientId: $response_id,
        input: $prompt,
        modelId: "gpt-5.6-luna",
        maxOutputTokens: 256,
        presetSelections: {},
        attachmentIds: [],
        agentMode: $agent_mode
      }
    }')"
  result="$(curl --fail --silent --show-error \
    --cookie "${cookie_jar}" \
    --header 'content-type: application/json' \
    --data "${payload}" \
    "${PREVIEW_URL}/api/chats/start")"
  jq -er '.response.responseId' <<<"${result}"
}

wait_for_response() {
  local response_id="$1"
  local max_attempts="$2"
  local attempt snapshot status
  for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
    snapshot="$(curl --fail --silent --show-error \
      --cookie "${cookie_jar}" \
      "${PREVIEW_URL}/api/responses/${response_id}")"
    status="$(jq -r '.status' <<<"${snapshot}")"
    case "${status}" in
      completed)
        printf '%s' "${snapshot}"
        return 0
        ;;
      failed|cancelled|incomplete)
        jq -c '{status, error}' <<<"${snapshot}" >&2
        return 1
        ;;
    esac
    sleep 2
  done
  echo "Preview response ${response_id} did not reach a terminal state." >&2
  return 1
}

normal_response_id="$(start_response 'Reply with exactly PREVIEW_OK.' false)"
normal_snapshot="$(wait_for_response "${normal_response_id}" 60)"
jq -e 'any(.output[]?; .type == "message" and .status == "completed")' <<<"${normal_snapshot}" >/dev/null || {
  echo 'Preview Luna smoke response completed without an assistant message.' >&2
  exit 1
}

agent_response_id="$(start_response 'Use the bash tool to run printf AGENT_WORKSPACE_OK, then reply with exactly AGENT_WORKSPACE_OK.' true)"
agent_snapshot="$(wait_for_response "${agent_response_id}" 180)"
jq -e 'any(.output[]?; .type == "pulpo_workspace" and (.state == "ready" or .state == "released"))' <<<"${agent_snapshot}" >/dev/null || {
  echo 'Preview agent smoke response completed without a ready workspace.' >&2
  exit 1
}
jq -e 'any(.output[]?; .type == "pulpo_tool" and .tool == "bash" and .status == "completed" and (.isError // false) == false)' <<<"${agent_snapshot}" >/dev/null || {
  echo 'Preview agent smoke response did not complete its bash tool call.' >&2
  exit 1
}

echo 'Preview bootstrap, Luna generation, and agent workspace smoke tests passed.'
