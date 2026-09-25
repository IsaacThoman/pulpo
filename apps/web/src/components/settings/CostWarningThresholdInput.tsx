import { useEffect, useState } from 'react'
import { AGENT_COST_WARNING_MAX_MICROS, AGENT_COST_WARNING_MIN_MICROS } from '@pulpo/contracts'
import { Input } from '@/components/ui/input'
import { ui } from '@/i18n/ui'
import { parseCostWarningThreshold } from './cost-warning-threshold'

function formatDollars(micros: number): string {
  return String(micros / 1_000_000)
}

export function CostWarningThresholdInput({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState(() => formatDollars(value))

  useEffect(() => {
    setDraft(formatDollars(value))
  }, [value])

  const commit = () => {
    const next = parseCostWarningThreshold(draft) ?? value
    setDraft(formatDollars(next))
    if (next !== value) onChange(next)
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">$</span>
      <Input
        aria-label={ui("Agent cost warning threshold in US dollars")}
        className="w-24 tabular-nums"
        type="number"
        inputMode="decimal"
        min={AGENT_COST_WARNING_MIN_MICROS / 1_000_000}
        max={AGENT_COST_WARNING_MAX_MICROS / 1_000_000}
        step={0.01}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') setDraft(formatDollars(value))
        }}
      />
    </div>
  )
}
