import { LegalPage } from './LegalPage'
import { ui } from '@/i18n/ui'

export function SupportPage() {
  return <LegalPage title={ui("Pulpo support")}>
    <section>
      <h2>{ui("Get help")}</h2>
      <p>{ui("For the Pulpo iPhone app and the default pulpo.baby service, report a problem or request help in the")} <a href="https://github.com/IsaacThoman/pulpo/issues">{ui("Pulpo GitHub issue tracker")}</a>{ui(". Do not include passwords, bearer tokens, private conversation content, or provider keys.")}</p>
    </section>
    <section>
      <h2>{ui("Self-hosted instances")}</h2>
      <p>{ui("If you connected the app to another Pulpo instance, contact that instance's operator for account approval, password resets, retention, provider configuration, billing, availability, and data requests.")}</p>
    </section>
    <section>
      <h2>{ui("Useful diagnostics")}</h2>
      <p>{ui("Include the app version, iOS version, instance URL, the action you attempted, and the displayed error code. You can switch instances or clear downloaded data from Settings without sharing secret credentials.")}</p>
    </section>
  </LegalPage>
}
