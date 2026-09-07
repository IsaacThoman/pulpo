# Apple Shortcuts

Pulpo's native iOS app exposes eight actions in Apple's Shortcuts app. Four App
Shortcuts also appear automatically under **App Shortcuts → Pulpo**: Ask Pulpo,
New Chat, Find Chats, and Open Chat. Open Pulpo and sign in once before using them.
This requires a native build; Expo Go and Android do not expose Apple actions.

In Pulpo, **Settings → Apple Shortcuts** explains the actions, opens Shortcuts,
and lets you disable their access on this device. Actions require an unlocked
device, the signed-in account, and an internet connection. Siri can use phrases
such as “Ask Pulpo” and “New chat in Pulpo.”

## Actions

| Action | Inputs | Output / behavior |
| --- | --- | --- |
| Ask Pulpo | Prompt, Model, Temporary Chat | Sends a prompt, waits for completion, and returns the text reply; Siri can speak it. |
| Start Chat in Pulpo | Prompt, Model | Sends a prompt and immediately returns a saved Chat while the reply runs on the server. |
| Continue Chat in Pulpo | Chat, Prompt | Sends on the active branch using that chat's model; returns the completed text reply. Rejects chats with active replies or queued messages. |
| Get Reply from Pulpo | Chat | Returns the completed text on the active branch without sending anything. Reports unfinished/failed/cancelled replies. |
| Find Chats in Pulpo | Search, Limit (1–50) | Searches saved titles and contents, newest first. Empty Search returns recent chats. Temporary, deleted, and expired chats are excluded. |
| Get Models from Pulpo | None | Returns available Models, including their Name and Provider properties. |
| Open Chat in Pulpo | Chat | Opens that saved chat in the app. |
| New Chat in Pulpo | Temporary Chat | Opens the composer, preserving existing drafts. Does not send anything. |

Chat and Model parameters offer live, searchable pickers. A saved selection is
bound to its original account and server. It cannot silently resolve against a
different account after sign-out or server switching. Re-select the item when
intentionally moving a workflow to another account. Actions without a selected
item, such as Find Chats, use the account currently signed in to Pulpo.

Prompts use normal billing and the selected model's server defaults. Saved chats
honor the account's server-synchronized new-chat auto-expiration preference. These
actions send text with Agent mode off; they do not inherit the open composer's
attachments, draft, or personal generation controls. Text results include the
assistant's final messages and refusals, excluding reasoning and tool output.

## Useful workflows

- **Dictate a question:** Dictate Text → Ask Pulpo (Prompt = Dictated Text,
  choose a Model) → Speak Text (Reply). You can assign the shortcut to your
  Action button or Home Screen.
- **Summarize shared text:** Create a shortcut that receives Text and URLs from
  the share sheet. Use a Text action to combine “Summarize this:” with Shortcut
  Input → Ask Pulpo → Show Result. A URL is passed as text; these actions do not
  themselves fetch its webpage.
- **Long-running model:** Text → Start Chat in Pulpo → Open Chat in Pulpo. The
  returned Chat can also feed Get Reply in a later step after completion.
- **Continue a project:** Find Chats (search for your project) → Choose from
  List → Continue Chat → Show Result.
- **Choose the model each time:** Get Models → Choose from List → Ask Pulpo.
- **Private question:** Ask Pulpo with Temporary Chat enabled. Temporary chats
  follow the server's expiration policy and are excluded from saved history,
  search, and recall. The returned text is still available to your shortcut and
  any actions you connect to it.

## Slow replies and interruptions

Ask and Continue poll for up to approximately 50 seconds after submission. The
system can impose a shorter execution limit. If a reply takes longer, the action
reports that it is still running; the server continues the work. Open Pulpo to
review it. Use Start Chat and Get Reply when composing workflows with slow models.
Temporary chats cannot be selected later as saved Chat entities.

There are no automatic POST retries or offline sends. If connectivity is lost
after submission, the server may already have accepted the prompt. Check Pulpo
before rerunning Ask or Start Chat: a new invocation creates a new chat and may
incur another charge. Concurrent changes from another client follow the normal
server branch behavior; Continue targets the branch it read before submission.

## Native implementation and validation

`modules/pulpo-shortcuts/ios` is an app-local Expo module. The native client uses
an app-private Keychain session snapshot, accessible only while unlocked and
only on this device. Sign-out, unauthorized sessions, pending/blocked accounts,
and instance changes clear or replace it synchronously. A failed Keychain update
marks Shortcuts unavailable, including across relaunches. Credentials are never
stored in defaults, entity identifiers, URLs, shared containers, or test logs.
Only the disabled/unavailable flags use UserDefaults.

The config plugin copies `intents/PulpoAppIntents.swift` into the generated app's
main target so Xcode extracts App Intents metadata and Siri phrases. Do not move
those definitions into an unreferenced pod or commit the generated `ios/` tree.
See Apple's [App Intents documentation](https://developer.apple.com/documentation/appintents/appintent)
and [App Shortcuts documentation](https://developer.apple.com/documentation/appintents/app-shortcuts).

```sh
npm run mobile:typecheck
npm test -w @pulpo/mobile
npm run test:shortcuts:native -w @pulpo/mobile # macOS / Xcode
```

For real API/worker acceptance, start and seed the disposable queue fixture using
[e2e/README.md](e2e/README.md), then run:

```sh
PULPO_SHORTCUTS_ACCEPTANCE=1 swift run \
  --package-path apps/mobile/modules/pulpo-shortcuts PulpoShortcutsAcceptance
```

This acceptance executable is restricted to the loopback fixture on port 8091
and its documented test account. It creates test conversations, verifies real
model output and account revocation, and never prints or persists credentials.

For simulator QA, build the regenerated native application, sign in to the
fixture, and verify all eight actions under Shortcuts → Pulpo. Exercise an Ask
result, Start Chat → Open Chat, Find → Choose → Continue, temporary questions,
long-running responses, disabled access, sign-out, and account-scoped links.
Check new/open chat navigation both with the app running and after termination.
