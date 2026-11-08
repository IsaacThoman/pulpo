import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ui, uit } from '@/i18n/ui'

/** section container */
export function Section({
  title,
  hint,
  children,
  danger,
}: {
  title: string
  hint?: string
  children: ReactNode
  danger?: boolean
}) {
  return (
    <section className="@container mb-7">
      <h3
        className={cn(
          'text-sm font-semibold',
          danger && 'text-destructive'
        )}
      >
        {title}
      </h3>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-3 divide-y rounded-xl border bg-card px-4 [&>*]:py-3">{children}</div>
    </section>
  )
}

/** Props a field row hands its control so the visible label and hint name and describe it. */
export interface FieldControlProps {
  id: string
  'aria-describedby'?: string
}

/**
 * Horizontal label + control row. Pass a render function as children to receive the ids
 * that tie the visible label (`<label htmlFor>`) and hint (`aria-describedby`) to the control.
 */
export function Field({
  label,
  hint,
  children,
  indent,
}: {
  label: string
  hint?: string
  children: ReactNode | ((control: FieldControlProps) => ReactNode)
  indent?: boolean
}) {
  const baseId = useId()
  const controlId = `${baseId}-control`
  const hintId = hint ? `${baseId}-hint` : undefined
  const labelsControl = typeof children === 'function'
  return (
    <div className={cn('flex min-w-0 flex-col items-stretch gap-2 @xl:flex-row @xl:items-center @xl:justify-between @xl:gap-6', indent && 'pl-4')}>
      <div className="min-w-0 wrap-anywhere">
        {labelsControl
          ? <label htmlFor={controlId} className="block text-sm">{label}</label>
          : <div className="text-sm">{label}</div>}
        {hint && <div id={hintId} className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="min-w-0 max-w-full self-start @xl:shrink-0 @xl:self-auto [&_input]:max-w-full [&_[data-slot=select-trigger]]:max-w-full">
        {typeof children === 'function' ? children({ id: controlId, 'aria-describedby': hintId }) : children}
      </div>
    </div>
  )
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
  indent,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
  indent?: boolean
}) {
  return (
    <Field label={label} hint={hint} indent={indent}>
      {(control) => <Switch {...control} checked={checked} onCheckedChange={onChange} />}
    </Field>
  )
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  indent,
  mono,
  disabled,
}: {
  label: string
  hint?: string
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  indent?: boolean
  mono?: boolean
  disabled?: boolean
}) {
  return (
    <Field label={label} hint={hint} indent={indent}>
      {(control) => (
        <Input
          {...control}
          className={cn('w-64', mono && 'font-mono text-xs')}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
        />
      )}
    </Field>
  )
}

function formatNumFieldValue(value: number, decimals?: number): string {
  return decimals === undefined ? String(value) : value.toFixed(decimals)
}

export function NumField({
  label,
  hint,
  value,
  onChange,
  indent,
  suffix,
  min,
  max,
  step,
  decimals,
}: {
  label: string
  hint?: string
  value: number
  onChange?: (v: number) => void
  indent?: boolean
  suffix?: string
  min?: number
  max?: number
  step?: number
  decimals?: number
}) {
  const focused = useRef(false)
  const [draft, setDraft] = useState(() => formatNumFieldValue(value, decimals))
  useEffect(() => {
    if (!focused.current) setDraft(formatNumFieldValue(value, decimals))
  }, [value, decimals])

  return (
    <Field label={label} hint={hint} indent={indent}>
      {(control) => <div className="flex items-center gap-2">
        <Input
          id={control.id}
          aria-describedby={[control['aria-describedby'], suffix ? `${control.id}-suffix` : undefined].filter(Boolean).join(' ') || undefined}
          type="number"
          min={min}
          max={max}
          step={step}
          className="w-28 text-right tabular-nums"
          value={decimals === undefined ? value : draft}
          onFocus={() => { focused.current = true }}
          onChange={(e) => {
            if (decimals !== undefined) setDraft(e.target.value)
            const parsed = parseFloat(e.target.value)
            onChange?.(Number.isFinite(parsed) ? parsed : 0)
          }}
          onBlur={() => {
            focused.current = false
            if (decimals === undefined) return
            const parsed = parseFloat(draft)
            const normalized = Number.isFinite(parsed) ? parsed : 0
            onChange?.(normalized)
            setDraft(normalized.toFixed(decimals))
          }}
        />
        {suffix && <span id={`${control.id}-suffix`} className="text-xs text-muted-foreground">{suffix}</span>}
      </div>}
    </Field>
  )
}

export function SecretField({
  label,
  hint,
  value,
  onChange,
  indent,
  configured,
  show: controlledShow,
  onShowChange,
}: {
  label: string
  hint?: string
  value: string
  onChange?: (v: string) => void
  indent?: boolean
  configured?: boolean
  show?: boolean
  onShowChange?: (show: boolean) => void
}) {
  const [localShow, setLocalShow] = useState(false)
  const show = controlledShow ?? localShow
  const setShow = onShowChange ?? setLocalShow
  return (
    <Field label={label} hint={hint} indent={indent}>
      {(control) => <div className="relative">
        <Input
          {...control}
          type={show ? 'text' : 'password'}
          className="w-64 pr-8 font-mono text-xs"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder="••••••••"
        />
        {(value || configured) && <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
          onClick={() => setShow(!show)}
          aria-label={uit`${show ? 'Hide' : 'Show'} ${label}`}
        >
          {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>}
      </div>}
    </Field>
  )
}

export function SelectField<T extends string>({
  label,
  hint,
  value,
  onChange,
  options,
  indent,
  width = 'w-64',
}: {
  label: string
  hint?: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  indent?: boolean
  width?: string
}) {
  return (
    <Field label={label} hint={hint} indent={indent}>
      {(control) => (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger {...control} className={width}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  )
}

export function TextAreaField({
  label,
  hint,
  value,
  onChange,
  rows = 3,
  mono,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  rows?: number
  mono?: boolean
}) {
  const baseId = useId()
  return (
    <div>
      <label htmlFor={`${baseId}-control`} className="block text-sm">{label}</label>
      {hint && <div id={`${baseId}-hint`} className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      <Textarea
        id={`${baseId}-control`}
        aria-describedby={hint ? `${baseId}-hint` : undefined}
        className={cn('mt-2', mono && 'font-mono text-xs')}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

/** sticky save bar for settings pages */
export function SaveBar({ onSave }: { onSave?: () => void | Promise<void> }) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const mounted = useRef(false)
  const saving = useRef(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (resetTimer.current !== null) {
        clearTimeout(resetTimer.current)
        resetTimer.current = null
      }
    }
  }, [])

  const save = async () => {
    if (!onSave || saving.current) return
    saving.current = true
    if (resetTimer.current !== null) {
      clearTimeout(resetTimer.current)
      resetTimer.current = null
    }
    setStatus('saving')
    try {
      await onSave()
      if (!mounted.current) return
      setStatus('saved')
      resetTimer.current = setTimeout(() => {
        resetTimer.current = null
        if (mounted.current) setStatus('idle')
      }, 1500)
    } catch {
      if (mounted.current) setStatus('error')
    } finally {
      saving.current = false
    }
  }

  return (
    <div className="sticky bottom-0 -mx-1 flex justify-end border-t bg-background/80 px-1 py-3 backdrop-blur">
      <Button
        size="sm"
        onClick={() => void save()}
        disabled={!onSave || status === 'saving'}
      >
        {status === 'saving' ? ui("Saving…") : status === 'saved' ? ui("Saved ✓") : status === 'error' ? ui("Save failed — retry") : ui("Save")}
      </Button>
    </div>
  )
}
