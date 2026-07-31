import { useState, type ReactNode } from 'react'
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
    <section className="mb-7">
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

/** horizontal label + control row */
export function Field({
  label,
  hint,
  children,
  indent,
}: {
  label: string
  hint?: string
  children: ReactNode
  indent?: boolean
}) {
  return (
    <div className={cn('flex items-center justify-between gap-6', indent && 'pl-4')}>
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
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
      <Switch checked={checked} onCheckedChange={onChange} />
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
}: {
  label: string
  hint?: string
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  indent?: boolean
  mono?: boolean
}) {
  return (
    <Field label={label} hint={hint} indent={indent}>
      <Input
        className={cn('w-64', mono && 'font-mono text-xs')}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
      />
    </Field>
  )
}

export function NumField({
  label,
  hint,
  value,
  onChange,
  indent,
  suffix,
}: {
  label: string
  hint?: string
  value: number
  onChange?: (v: number) => void
  indent?: boolean
  suffix?: string
}) {
  return (
    <Field label={label} hint={hint} indent={indent}>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          className="w-28 text-right tabular-nums"
          value={value}
          onChange={(e) => onChange?.(parseFloat(e.target.value) || 0)}
        />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </Field>
  )
}

export function SecretField({
  label,
  hint,
  value,
  onChange,
  indent,
}: {
  label: string
  hint?: string
  value: string
  onChange?: (v: string) => void
  indent?: boolean
}) {
  const [show, setShow] = useState(false)
  return (
    <Field label={label} hint={hint} indent={indent}>
      <div className="relative">
        <Input
          type={show ? 'text' : 'password'}
          className="w-64 pr-8 font-mono text-xs"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder="••••••••"
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? 'Hide' : 'Show'}
        >
          {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      </div>
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
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={width}>
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
  return (
    <div>
      <div className="text-sm">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      <Textarea
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
  const [saved, setSaved] = useState(false)
  return (
    <div className="sticky bottom-0 -mx-1 flex justify-end border-t bg-background/80 px-1 py-3 backdrop-blur">
      <Button
        size="sm"
        onClick={() => {
          void onSave?.()
          setSaved(true)
          setTimeout(() => setSaved(false), 1500)
        }}
      >
        {saved ? 'Saved ✓' : 'Save'}
      </Button>
    </div>
  )
}
