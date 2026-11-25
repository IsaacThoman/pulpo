import { ArrowUpRight } from 'lucide-react'
import { useState } from 'react'
import type { Knowledge } from './api'
import { ResultImage } from './ResultImage'

export function KnowledgeCard({ knowledge, url, newTab, thumbnail }: {
  knowledge: Knowledge
  url: URL
  newTab: boolean
  thumbnail?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const hasMoreOnDesktop = knowledge.summary.length > 140 || knowledge.facts.length > 3
  const canExpand = hasMoreOnDesktop || knowledge.facts.length > 0
  const facts = expanded ? knowledge.facts : knowledge.facts.slice(0, 3)
  return (
    <aside className="answer knowledge-card" aria-label={'About ' + knowledge.title} data-collapsed={!expanded}>
      <div className="knowledge-overview">
        <div>
          <h2><a href={url.href} rel="noreferrer" target={newTab ? '_blank' : undefined}>{knowledge.title}<ArrowUpRight size={15} aria-hidden="true" /></a></h2>
          <p className={canExpand && !expanded ? 'knowledge-summary-brief' : undefined}>{knowledge.summary}</p>
        </div>
        {thumbnail && <ResultImage sources={[thumbnail]} alt="" fallback={null} lazy />}
      </div>
      {facts.length > 0 && (
        <dl>
          {facts.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      )}
      {canExpand && <button className={hasMoreOnDesktop ? 'text-button' : 'text-button knowledge-mobile-expand'}
        aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Show less' : 'Read more'}
      </button>}
      <div className="knowledge-source">
        Adapted from <a href={url.href} rel="noreferrer" target={newTab ? '_blank' : undefined}>Wikipedia</a>
        {' · '}<a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noreferrer" target={newTab ? '_blank' : undefined}>CC BY-SA 4.0</a>
      </div>
    </aside>
  )
}
