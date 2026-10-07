// Responses captured from a local Pulpo server (`npm run local:preview:reset`).
// Regenerate them when the API shape changes.
enum Fixtures {
    /// `GET /api/chats/:id?format=compact&scope=active` after a regeneration:
    /// the first assistant variant is an inactive stub.
    static let branchedChat = #"""
    {
      "id": "ac7dd103-7883-456f-adad-6178a8c18b77",
      "title": "🍎 Three Popular Fruits",
      "modelId": "gpt-5.6-luna",
      "pinned": false,
      "folderId": null,
      "sortOrder": 0,
      "temporary": false,
      "fileScopeIds": [],
      "activeResponseId": "651b3c88-035a-4689-ab8e-d500dcbafba6",
      "activeBranchLeafId": "651b3c88-035a-4689-ab8e-d500dcbafba6",
      "expiresAt": null,
      "createdAt": "2026-10-06T21:00:43.646Z",
      "updatedAt": "2026-10-06T21:11:21.615Z",
      "deletedAt": null,
      "attachments": [],
      "queuedMessages": [],
      "responses": [
        {
          "id": "6509cd4c-e70d-4fbe-9b12-93eca7172a43",
          "parentResponseId": null,
          "previousResponseId": null,
          "userMessageId": "01a11304-cb08-74db-af31-909e5a6b253b",
          "modelId": "gpt-5.6-luna",
          "displayModelId": "gpt-5.6-luna",
          "status": "completed",
          "input": [
            {
              "role": "user",
              "content": [
                {
                  "type": "input_text",
                  "text": "Reply with a short markdown list of 3 fruits and one sentence."
                }
              ]
            }
          ],
          "output": [
            {
              "id": "msg_0371264f4a395a96016ac5617e245887d2bd50fdbdf18aa98b",
              "type": "message",
              "status": "completed",
              "content": [
                {
                  "type": "output_text",
                  "annotations": [],
                  "logprobs": [],
                  "text": "- Apple\n- Banana\n- Orange\n\nThese are three popular fruits."
                }
              ],
              "phase": "final_answer",
              "role": "assistant"
            }
          ],
          "presetSelections": {},
          "usage": {
            "inputTokens": 165,
            "totalTokens": 184,
            "outputTokens": 19,
            "reasoningTokens": 0,
            "cacheWriteTokens": 0,
            "cachedInputTokens": 0
          },
          "costMicros": 0,
          "inferenceReferenceCostMicros": 0,
          "subscriptionCoveredMicros": 0,
          "error": null,
          "createdAt": "2026-10-06T21:00:43.655Z",
          "completedAt": "2026-10-06T21:00:46.606Z",
          "agentMode": false,
          "snapshot": {
            "responseId": "6509cd4c-e70d-4fbe-9b12-93eca7172a43",
            "requestReceivedAt": "2026-10-06T21:00:43.619Z",
            "firstReplyTextAt": "2026-10-06T21:00:46.251Z",
            "status": "completed",
            "sequence": 23,
            "usage": {
              "inputTokens": 165,
              "totalTokens": 184,
              "outputTokens": 19,
              "reasoningTokens": 0,
              "cacheWriteTokens": 0,
              "cachedInputTokens": 0
            },
            "error": null,
            "updatedAt": "2026-10-06T21:00:46.606Z"
          },
          "branches": {
            "user": {
              "ids": [
                "6509cd4c-e70d-4fbe-9b12-93eca7172a43"
              ],
              "index": 0
            },
            "assistant": {
              "ids": [
                "6509cd4c-e70d-4fbe-9b12-93eca7172a43"
              ],
              "index": 0
            }
          },
          "detailAvailable": true
        },
        {
          "id": "99ebb8a9-1fae-476d-9e43-f70af7ceabcd",
          "parentResponseId": "6509cd4c-e70d-4fbe-9b12-93eca7172a43",
          "previousResponseId": "6509cd4c-e70d-4fbe-9b12-93eca7172a43",
          "userMessageId": "01a1130e-6967-7683-9c38-49186e7e8039",
          "modelId": "gpt-5.6-luna",
          "displayModelId": "gpt-5.6-luna",
          "status": "completed",
          "input": [],
          "output": [],
          "presetSelections": {},
          "usage": null,
          "costMicros": null,
          "inferenceReferenceCostMicros": null,
          "subscriptionCoveredMicros": null,
          "error": null,
          "createdAt": "2026-10-06T21:11:14.019Z",
          "completedAt": "2026-10-06T21:11:17.760Z",
          "agentMode": false,
          "snapshot": {
            "responseId": "99ebb8a9-1fae-476d-9e43-f70af7ceabcd",
            "requestReceivedAt": "2026-10-06T21:11:13.976Z",
            "firstReplyTextAt": "2026-10-06T21:11:17.253Z",
            "status": "completed",
            "sequence": 53,
            "usage": {
              "inputTokens": 210,
              "totalTokens": 281,
              "outputTokens": 71,
              "reasoningTokens": 22,
              "cacheWriteTokens": 0,
              "cachedInputTokens": 0
            },
            "error": null,
            "updatedAt": "2026-10-06T21:11:17.760Z"
          },
          "branches": {
            "user": {
              "ids": [
                "99ebb8a9-1fae-476d-9e43-f70af7ceabcd"
              ],
              "index": 0
            },
            "assistant": {
              "ids": [
                "99ebb8a9-1fae-476d-9e43-f70af7ceabcd",
                "651b3c88-035a-4689-ab8e-d500dcbafba6"
              ],
              "index": 0
            }
          },
          "detailAvailable": false
        },
        {
          "id": "651b3c88-035a-4689-ab8e-d500dcbafba6",
          "parentResponseId": "6509cd4c-e70d-4fbe-9b12-93eca7172a43",
          "previousResponseId": "6509cd4c-e70d-4fbe-9b12-93eca7172a43",
          "userMessageId": "01a1130e-6967-7683-9c38-49186e7e8039",
          "modelId": "gpt-5.6-luna",
          "displayModelId": "gpt-5.6-luna",
          "status": "completed",
          "input": [
            {
              "role": "user",
              "content": [
                {
                  "type": "input_text",
                  "text": "Now show a tiny Swift code block and a 2-column markdown table of those fruits with colors."
                }
              ]
            }
          ],
          "output": [
            {
              "id": "msg_0371264f4a395a96016ac563f8f34c87d2ace4be207a3e50ca",
              "type": "message",
              "status": "completed",
              "content": [
                {
                  "type": "output_text",
                  "annotations": [],
                  "logprobs": [],
                  "text": "```swift\nlet fruits = [\"Apple\", \"Banana\", \"Orange\"]\n```\n\n| Fruit  | Color  |\n|--------|--------|\n| Apple  | Red    |\n| Banana | Yellow |\n| Orange | Orange |"
                }
              ],
              "phase": "final_answer",
              "role": "assistant"
            }
          ],
          "presetSelections": {},
          "usage": {
            "inputTokens": 210,
            "totalTokens": 261,
            "outputTokens": 51,
            "reasoningTokens": 0,
            "cacheWriteTokens": 0,
            "cachedInputTokens": 0
          },
          "costMicros": 0,
          "inferenceReferenceCostMicros": 0,
          "subscriptionCoveredMicros": 0,
          "error": null,
          "createdAt": "2026-10-06T21:11:18.466Z",
          "completedAt": "2026-10-06T21:11:21.615Z",
          "agentMode": false,
          "snapshot": {
            "responseId": "651b3c88-035a-4689-ab8e-d500dcbafba6",
            "requestReceivedAt": "2026-10-06T21:11:18.416Z",
            "firstReplyTextAt": "2026-10-06T21:11:21.107Z",
            "status": "completed",
            "sequence": 55,
            "usage": {
              "inputTokens": 210,
              "totalTokens": 261,
              "outputTokens": 51,
              "reasoningTokens": 0,
              "cacheWriteTokens": 0,
              "cachedInputTokens": 0
            },
            "error": null,
            "updatedAt": "2026-10-06T21:11:21.615Z"
          },
          "branches": {
            "user": {
              "ids": [
                "651b3c88-035a-4689-ab8e-d500dcbafba6"
              ],
              "index": 0
            },
            "assistant": {
              "ids": [
                "99ebb8a9-1fae-476d-9e43-f70af7ceabcd",
                "651b3c88-035a-4689-ab8e-d500dcbafba6"
              ],
              "index": 1
            }
          },
          "detailAvailable": true
        }
      ]
    }
    """#

    static let chatList = #"""
    {
      "data": [
        {
          "id": "ac7dd103-7883-456f-adad-6178a8c18b77",
          "userId": "00000000-0000-7000-8000-000000000101",
          "folderId": null,
          "title": "🍎 Three Popular Fruits",
          "modelId": "gpt-5.6-luna",
          "pinned": false,
          "sortOrder": 0,
          "temporary": false,
          "fileScopeIds": [],
          "activeBranchLeafId": "651b3c88-035a-4689-ab8e-d500dcbafba6",
          "activeResponseId": "651b3c88-035a-4689-ab8e-d500dcbafba6",
          "expiresAt": null,
          "deletedAt": null,
          "purgeStartedAt": null,
          "createdAt": "2026-10-06T21:00:43.646Z",
          "updatedAt": "2026-10-06T21:11:21.615Z",
          "inFlightResponseIds": []
        }
      ]
    }
    """#

    static let models = #"""
    {
      "codexEnabled": false,
      "agentAvailable": true,
      "data": [
        {
          "id": "gpt-5.6-luna",
          "upstreamModelId": "gpt-5.6-luna",
          "name": "GPT-5.6 Luna",
          "description": "GPT-5.6 Luna through the budget-limited Pulpo Baby preview provider.",
          "warningMessage": "",
          "warningDismissDays": 30,
          "enabled": true,
          "visible": true,
          "logo": "openai",
          "customIcon": null,
          "executionMode": "stream",
          "contextWindow": 128000,
          "maxOutputTokens": 16384,
          "inputPriceMicros": 0,
          "cachedInputPriceMicros": 0,
          "cacheWritePriceMicros": 0,
          "outputPriceMicros": 0,
          "perRequestPriceMicros": 0,
          "tags": [
            "Reasoning",
            "Agent"
          ],
          "agentEnabled": true,
          "provider": {
            "id": "00000000-0000-7000-8000-000000000102",
            "name": "Pulpo Baby"
          },
          "lab": {
            "id": "00000000-0000-7000-8000-000000000103",
            "name": "OpenAI",
            "logo": "openai",
            "customIcon": null
          },
          "iconLight": null,
          "iconDark": null,
          "presets": []
        }
      ]
    }
    """#
}
