import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ANIMATION_SPEED_MAX,
  ANIMATION_SPEED_MIN,
  clampAnimationSpeed,
  DEFAULT_ANIMATION_SPEED,
} from '@/lib/animation-speed'
import { ui } from '@/i18n/ui'

function formatSpeed(value: number): string {
  return String(value)
}

export function AnimationSpeedInput({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
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
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5">
        <Input
          aria-label={ui("Animation speed multiplier")}
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
        <span aria-hidden="true" className="text-xs text-muted-foreground">×</span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={value === DEFAULT_ANIMATION_SPEED}
        onClick={() => {
          setDraft(formatSpeed(DEFAULT_ANIMATION_SPEED))
          onChange(DEFAULT_ANIMATION_SPEED)
        }}
      >
        {ui("Reset")}
      </Button>
    </div>
  )
}
