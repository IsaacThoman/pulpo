import { useState } from 'react'
import type { FileNode } from '@pulpo/contracts'
import { Check, Loader2, MessageSquareDiff, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { filesErrorMessage } from './file-display'
import { suggestionRoot, useResolveFileSuggestion } from './use-file-suggestion'

/** Marks an item an agent suggested creating, until the owner accepts or rejects it. */
export function SuggestedBadge({ className }: { className?: string }) {
  return (
    <span
      title={ui("Suggested by an agent. Accept it to keep it, or reject it to delete it.")}
      className={cn('shrink-0 rounded border border-dashed !border-sky-600/50 px-1 text-[11px] leading-4 text-sky-700 dark:!border-sky-400/50 dark:text-sky-300', className)}
    >
      {ui("Suggested")}
    </span>
  )
}

/**
 * Shown above a file or folder an agent suggested creating. An item inside a suggested folder
 * is part of that folder's suggestion, so the banner names the folder and acts on all of it.
 * Rejecting deletes the suggestion for good, so the view has to go somewhere that still exists
 * (`onRejected`, given the item that was deleted).
 */
export function FileSuggestionBanner({ node, ancestors, onRejected }: {
  node: FileNode
  /** The folders above `node`, from the top of My files down. */
  ancestors: readonly FileNode[]
  onRejected: (root: FileNode) => void
}) {
  const resolve = useResolveFileSuggestion()
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!node.suggestion) return null
  const root = suggestionRoot(node, ancestors)
  const part = root.id !== node.id

  const run = async (action: 'accept' | 'reject') => {
    setBusy(action)
    setError(null)
    try {
      await resolve(root, action)
      if (action === 'reject') onRejected(root)
    } catch (cause) {
      setError(filesErrorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div role="status" className="flex flex-wrap items-center gap-2 border-b bg-sky-500/10 px-4 py-2 text-sm text-sky-900 sm:px-6 dark:bg-sky-400/10 dark:text-sky-100">
      <MessageSquareDiff className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
      <span className="min-w-0 flex-1">
        {part
          ? uit`This is part of the folder “${root.name}” an agent suggested. Accept the folder to keep everything in it, or reject it to delete it all.`
          : node.kind === 'folder'
            ? ui("An agent suggested this folder. Accept it to keep it, or reject it to delete it with its contents.")
            : ui("An agent suggested this file. Accept it to keep it, or reject it to delete it.")}
        {error && <span role="alert" className="block text-destructive">{error}</span>}
      </span>
      <Button size="sm" variant="outline" className="h-7" disabled={Boolean(busy)} onClick={() => void run('reject')}>
        {busy === 'reject' ? <Loader2 className="animate-spin" /> : <X />} {part ? ui("Reject folder") : ui("Reject")}
      </Button>
      <Button size="sm" className="h-7" disabled={Boolean(busy)} onClick={() => void run('accept')}>
        {busy === 'accept' ? <Loader2 className="animate-spin" /> : <Check />} {part ? ui("Accept folder") : ui("Accept")}
      </Button>
    </div>
  )
}
