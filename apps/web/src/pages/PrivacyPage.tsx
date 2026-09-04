import { LegalPage } from './LegalPage'
import { ui } from '@/i18n/ui'

export function PrivacyPage() {
  return <LegalPage title={ui("Privacy policy")} updated="September 3, 2026">
    <section>
      <h2>{ui("What Pulpo stores")}</h2>
      <p>{ui("Pulpo stores the account information you provide, including your name, email address, account identifier, and optional two-factor authentication configuration. Authenticator secrets are encrypted and recovery codes are stored as one-way hashes. If you add a passkey, the server stores its name, public key, credential identifier, usage counter, device and backup metadata, transports, and created and last-used dates. Your private passkey remains with your device or passkey provider and is never sent to Pulpo. Pulpo also stores content you choose to create or upload, such as conversations, prompts, generated responses, files, photos, folder organization, model preferences, and public-share settings.")}</p>
    </section>
    <section>
      <h2>{ui("Where your data goes")}</h2>
      <p>{ui("The iPhone app sends data to the Pulpo instance you select. If you connect to a self-hosted instance, that instance's operator controls its storage, retention, providers, and access policies. Conversation content and attachments may be sent by that instance to the AI and tool providers its operator configures in order to fulfill your requests.")}</p>
    </section>
    <section>
      <h2>{ui("Memories and relevant-chat recall")}</h2>
      <p>{ui("When Memories is enabled, Pulpo includes your editable MEMORY.md profile in eligible conversations. Agent mode maintains it as useful context for future conversations; prior versions remain restorable for 24 hours. When the instance's episodic-memory feature is also enabled, Pulpo indexes eligible normal chats using the instance's Ollama embedding service. Temporary, trashed, and expired chats are excluded. Turning Memories off stops MEMORY.md use and deletes your derived chat embeddings while retaining the document. Ordinary chat exports do not include MEMORY.md or derived embeddings.")}</p>
    </section>
    <section>
      <h2>{ui("Data on your device")}</h2>
      <p>{ui("Your bearer session token is stored in iOS Keychain. The app keeps namespaced local copies of preferences, drafts, recent conversations, search documents, response cursors, queued offline-safe changes, and attachment cache metadata in SQLite. Downloaded attachment bytes are kept in the app cache. Signing out, switching instances, and the in-app data controls remove the relevant local data.")}</p>
    </section>
    <section>
      <h2>{ui("Analytics and tracking")}</h2>
      <p>{ui("The app does not include advertising SDKs, cross-app tracking, or product analytics. Operational server logs exclude passwords, bearer tokens, prompts, response bodies, and provider secrets.")}</p>
    </section>
    <section>
      <h2>{ui("Control and deletion")}</h2>
      <p>{ui("You can edit profile details, delete conversations and cached downloads, and sign out in the app. For account deletion, retention questions, or a copy of server-held data, contact the operator of your selected Pulpo instance. For the default service, open a request through")} <a href="https://github.com/IsaacThoman/pulpo/issues">{ui("Pulpo support")}</a>.</p>
    </section>
    <section>
      <h2>{ui("Security and changes")}</h2>
      <p>{ui("Pulpo uses HTTPS for production instances, verifies passkey user presence and identity, and keeps native bearer sessions revocable. Adding or deleting a passkey requires your password and existing second factor when enabled, then signs out your other sessions. No system is perfectly secure. This policy may change as the service evolves; material revisions will be posted on this page with a new effective date.")}</p>
      <p>{ui("Authorized administrators may access and modify an individual conversation when reasonably necessary for support, safety, security, or service operations. This access is limited to the selected conversation, requires administrator two-factor authentication, and expires automatically. Model usage initiated by the administrator is charged to the administrator rather than the conversation owner.")}</p>
    </section>
  </LegalPage>
}
