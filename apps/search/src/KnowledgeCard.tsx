import type { Knowledge } from './api'

export function KnowledgeCard({ knowledge, url, newTab }: {
  knowledge: Knowledge
  url: URL
  newTab: boolean
}) {
  return (
    <aside className="answer knowledge-card" aria-label={'About ' + knowledge.title}>
      <h2>{knowledge.title}</h2>
      <p>{knowledge.summary}</p>
      {knowledge.facts.length > 0 && (
        <dl>
          {knowledge.facts.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      )}
      <div className="knowledge-source">
        Adapted from <a href={url.href} rel="noreferrer" target={newTab ? '_blank' : undefined}>Wikipedia</a>
        {' · '}<a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noreferrer" target={newTab ? '_blank' : undefined}>CC BY-SA 4.0</a>
      </div>
    </aside>
  )
}
