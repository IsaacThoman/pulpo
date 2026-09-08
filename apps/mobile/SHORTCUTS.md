# Apple Shortcuts

Pulpo's native iOS app exposes eight actions in Apple's Shortcuts app. Four App
Shortcuts also appear automatically under **App Shortcuts → Pulpo**: Ask Pulpo,
New Chat, Find Chats, and Open Chat. Open Pulpo and sign in once before using them.
This requires a native build; Expo Go and Android do not expose Apple actions.

Build workflows in Apple’s Shortcuts app using the Pulpo actions. Actions require
the signed-in account and an internet connection. Siri can use phrases such as
“Ask Pulpo” and “New chat in Pulpo.”

## Device lock behavior

Ask Pulpo and Start Chat with **Agent Mode off**, plus Get Models, can run while
the device is locked after its first unlock following a restart. Open Pulpo once
after updating to sync the session for background automation. Siri and automation
permissions configured in iOS still apply. These actions can spend account credit,
and Ask can return or speak the reply to the newly submitted prompt while locked.

Find Chats, Get Reply, Continue Chat, Open Chat, and New Chat retain authentication
and unlocked-device access. Saved-chat parameter lookups also require an unlocked
device, including lookups performed before an action runs. Get Reply still needs
an unlock even when its input comes from a preceding Start Chat action.

Ask and Start Chat with **Agent Mode on** require an unlocked device. Because
Apple's authentication policy is static for the entire action, these two actions
report an unlock-and-retry error when Agent Mode is enabled while locked; they do
not silently turn Agent Mode off or submit a request. The unlock requirement also
continues to apply to Agent Mode in Continue Chat.

## Actions

| Action | Inputs | Output / behavior |
| --- | --- | --- |
| Ask Pulpo | Prompt, Model, Temporary Chat, Agent Mode | Sends a prompt, waits for completion, and returns the text reply; Siri can speak it. |
| Start Chat in Pulpo | Prompt, Model, Agent Mode | Sends a prompt and immediately returns a saved Chat while the reply runs on the server. |
| Continue Chat in Pulpo | Chat, Prompt, Agent Mode | Sends on the active branch using that chat's model; returns the completed text reply. Rejects chats with active replies or queued messages. |
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
actions accept text prompts and offer an **Agent Mode** toggle in each action's
expanded options. It defaults to off, including in existing shortcuts. Turn it on
to use the server's agent tools. Both the server and selected model must support
Agent mode; unsupported configurations report an error before sending, without
silently falling back. Continue checks the existing chat's model. Each action uses
its own toggle rather than inheriting the app's or previous reply's Agent setting.
The open composer's attachments, draft, and personal generation controls are not
inherited. Text results include the assistant's final messages and refusals,
excluding reasoning and tool output.

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
- **Agent task:** Start Chat with Agent Mode enabled → Open Chat. The agent keeps
  working on the server; use Get Reply after it finishes. Ask and Continue support
  the same toggle, subject to the reply wait limit below.
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
two app-private, device-only Keychain session snapshots: the original
`WhenUnlockedThisDeviceOnly` record for sensitive actions and a separate
`AfterFirstUnlockThisDeviceOnly` record for basic automation. The latter contains
the same bearer token; its action restrictions are enforced by the native client,
not by a separate server permission scope. Basic automation cannot query saved
chats or send agent requests. Every request revalidates the appropriate record
before sending and after receiving a response. Sign-out, unauthorized sessions,
pending/blocked accounts, and instance changes clear or replace both records
synchronously. A failed Keychain update marks both access paths unavailable,
including across relaunches. Credentials are never stored in defaults, entity
identifiers, URLs, shared containers, or test logs.
Only the disabled/unavailable flags use UserDefaults. Foreground app bootstrap
waits for an active app state, so a cold background launch cannot mistake the
locked main SecureStore token for sign-out and revoke the automation session.

The config plugin copies `intents/PulpoAppIntents.swift` into the generated app's
main target so Xcode extracts App Intents metadata and Siri phrases. Do not move
those definitions into an unreferenced pod or commit the generated `ios/` tree.
Navigation actions use iOS 26 foreground execution and a bounded, in-process
native inbox to deliver scoped navigation requests, including before JavaScript
starts. The bridge subscribes before draining that inbox; request IDs deduplicate
delivery. External navigation-only links use the same parser. `OpenURLIntent`
cannot launch the custom `pulpo` scheme.
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

On a physical device, verify basic Ask, Start Chat, and Get Models while locked,
then verify history actions, saved-chat parameter lookups, and Agent Mode refuse
locked execution. Unlock and rerun the same actions successfully. Reboot and
check basic automation is unavailable until the first unlock. Confirm sign-out
and account switching revoke both access paths, including an in-flight reply.
Simulator and macOS unit tests do not validate physical-device lock behavior.

Simulator builds need Xcode's simulated Keychain entitlements and a development
signature carrying the app's team identity to execute App Shortcuts. An unsigned
build cannot save the session; an ad-hoc build can display the catalog but iOS
may refuse to resolve its App Shortcuts provider. If Xcode forces ad-hoc signing
for the simulator, re-sign the app and its debug/preview dylibs using your Apple
Development identity, retaining Xcode's embedded simulated entitlements. Do not
add device entitlements to the simulator's code signature. Physical-device
builds use the normal development signing and provisioning flow.
