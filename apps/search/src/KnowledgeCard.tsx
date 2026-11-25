import { useState } from 'react'
import type { Knowledge } from './api'

export function KnowledgeCard({ knowledge, url, newTab }: {
  knowledge: Knowledge
  url: URL
  newTab: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const canExpand = knowledge.summary.length > 140 || knowledge.facts.length > 3
  const facts = expanded ? knowledge.facts : knowledge.facts.slice(0, 3)
  return (
    <aside className="answer knowledge-card" aria-label={'About ' + knowledge.title}>
      <h2>{knowledge.title}</h2>
      <p className={canExpand && !expanded ? 'knowledge-summary-brief' : undefined}>{knowledge.summary}</p>
      {facts.length > 0 && (
        <dl>
          {facts.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      )}
      {canExpand && <button className="text-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Show less' : 'Read more'}
      </button>}
      <div className="knowledge-source">
        Adapted from <a href={url.href} rel="noreferrer" target={newTab ? '_blank' : undefined}>Wikipedia</a>
        {' · '}<a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noreferrer" target={newTab ? '_blank' : undefined}>CC BY-SA 4.0</a>
      </div>
    </aside>
  )
}
