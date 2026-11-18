import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { writeClipboardText } from '@/lib/clipboard'
import { ui } from '@/i18n/ui'

export function CopyTextButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="rounded-full"
      aria-label={copied ? ui("Copied") : ui("Copy text")}
      onClick={() => {
        void writeClipboardText(text).then((success) => {
          if (!success) return
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </Button>
  )
}
