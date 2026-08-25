import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ui } from '@/i18n/ui'

export function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-sm hover:bg-accent/60">
      <button
        role="checkbox"
        aria-checked={checked}
        onClick={(e) => {
          e.preventDefault()
          onChange(!checked)
        }}
        className={cn(
          'flex size-4 cursor-pointer items-center justify-center rounded border transition-colors',
          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-transparent'
        )}
      >
        {checked && <Check className="size-3" />}
      </button>
      {label}
    </label>
  )
}

export function Snippet({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="overflow-hidden rounded-lg border bg-zinc-950 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="text-[11px] font-medium text-zinc-400">{title}</span>
        <button
          className="flex cursor-pointer items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-100"
          onClick={() => {
            navigator.clipboard?.writeText(code).catch(() => {})
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? ui("copied") : ui("copy")}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-zinc-100">{code}</pre>
    </div>
  )
}
