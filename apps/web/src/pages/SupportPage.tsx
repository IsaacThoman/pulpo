import { LegalPage } from './LegalPage'

export function SupportPage() {
  return <LegalPage title="Pulpo support">
    <section>
      <h2>Get help</h2>
      <p>For the Pulpo iPhone app and the default pulpo.baby service, report a problem or request help in the <a href="https://github.com/IsaacThoman/pulpo/issues">Pulpo GitHub issue tracker</a>. Do not include passwords, bearer tokens, private conversation content, or provider keys.</p>
    </section>
    <section>
      <h2>Self-hosted instances</h2>
      <p>If you connected the app to another Pulpo instance, contact that instance's operator for account approval, password resets, retention, provider configuration, billing, availability, and data requests.</p>
    </section>
    <section>
      <h2>Useful diagnostics</h2>
      <p>Include the app version, iOS version, instance URL, the action you attempted, and the displayed error code. You can switch instances or clear downloaded data from Settings without sharing secret credentials.</p>
    </section>
  </LegalPage>
}
