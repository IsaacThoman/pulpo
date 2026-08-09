import { LegalPage } from './LegalPage'

export function PrivacyPage() {
  return <LegalPage title="Privacy policy" updated="August 9, 2026">
    <section>
      <h2>What Pulpo stores</h2>
      <p>Pulpo stores the account information you provide, including your name, email address, account identifier, and optional two-factor authentication configuration. Authenticator secrets are encrypted and recovery codes are stored as one-way hashes. It also stores content you choose to create or upload, such as conversations, prompts, generated responses, files, photos, folder organization, model preferences, and public-share settings.</p>
    </section>
    <section>
      <h2>Where your data goes</h2>
      <p>The iPhone app sends data to the Pulpo instance you select. If you connect to a self-hosted instance, that instance's operator controls its storage, retention, providers, and access policies. Conversation content and attachments may be sent by that instance to the AI and tool providers its operator configures in order to fulfill your requests.</p>
    </section>
    <section>
      <h2>Data on your device</h2>
      <p>Your bearer session token is stored in iOS Keychain. The app keeps namespaced local copies of preferences, drafts, recent conversations, search documents, response cursors, queued offline-safe changes, and attachment cache metadata in SQLite. Downloaded attachment bytes are kept in the app cache. Signing out, switching instances, and the in-app data controls remove the relevant local data.</p>
    </section>
    <section>
      <h2>Analytics and tracking</h2>
      <p>The app does not include advertising SDKs, cross-app tracking, or product analytics. Operational server logs exclude passwords, bearer tokens, prompts, response bodies, and provider secrets.</p>
    </section>
    <section>
      <h2>Control and deletion</h2>
      <p>You can edit profile details, delete conversations and cached downloads, and sign out in the app. For account deletion, retention questions, or a copy of server-held data, contact the operator of your selected Pulpo instance. For the default service, open a request through <a href="https://github.com/IsaacThoman/pulpo/issues">Pulpo support</a>.</p>
    </section>
    <section>
      <h2>Security and changes</h2>
      <p>Pulpo uses HTTPS for production instances and keeps native bearer sessions revocable. No system is perfectly secure. This policy may change as the service evolves; material revisions will be posted on this page with a new effective date.</p>
    </section>
  </LegalPage>
}
