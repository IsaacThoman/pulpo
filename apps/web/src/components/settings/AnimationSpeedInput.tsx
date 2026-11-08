import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import {
  ANIMATION_SPEED_MAX,
  ANIMATION_SPEED_MIN,
  clampAnimationSpeed,
} from '@/lib/animation-speed'
import { ui } from '@/i18n/ui'

function formatSpeed(value: number): string {
  return String(value)
}

export function AnimationSpeedInput({
  value,
  onChange,
  id,
  'aria-describedby': describedBy,
}: {
  value: number
  onChange: (value: number) => void
  /** Lets an external visible label point at the input (its own label already includes that text). */
  id?: string
  'aria-describedby'?: string
}) {
  const [draft, setDraft] = useState(() => formatSpeed(value))

  useEffect(() => {
    setDraft(formatSpeed(value))
  }, [value])

  const commit = () => {
    const parsed = Number(draft)
    const next = draft.trim() && Number.isFinite(parsed)
      ? clampAnimationSpeed(parsed)
      : value
    setDraft(formatSpeed(next))
    if (next !== value) onChange(next)
  }

  return (
    <Input
      id={id}
      aria-label={ui("Animation speed multiplier")}
      aria-describedby={describedBy}
      className="w-24 tabular-nums"
      type="number"
      min={ANIMATION_SPEED_MIN}
      max={ANIMATION_SPEED_MAX}
      step="any"
      value={draft}
      onChange={(event) => {
        const raw = event.currentTarget.value
        setDraft(raw)
        const parsed = Number(raw)
        if (raw.trim() && Number.isFinite(parsed) && parsed >= ANIMATION_SPEED_MIN && parsed <= ANIMATION_SPEED_MAX) {
          onChange(parsed)
        }
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') setDraft(formatSpeed(value))
      }}
    />
  )
}
