import { useEffect, useState } from 'react'
import { Check, Copy, Search } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import type { ApiKey } from '@/lib/types'
import { useApiKeys } from '@/stores/apiKeys'
import { ui, uit } from '@/i18n/ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

export function RenameApiKeyDialog({ apiKey, onClose }: { apiKey: ApiKey; onClose: () => void }) {
  const renameKey = useApiKeys((state) => state.renameKey)
  const [name, setName] = useState(apiKey.name)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const canSave = name.trim().length > 0 && name.trim().length <= 120 && name.trim() !== apiKey.name

  const save = async () => {
    if (saving || !canSave) return
    setSaving(true)
    setFailed(false)
    try {
      await renameKey(apiKey.id, name.trim())
      onClose()
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose() }}>
      <DialogContent className="sm:max-w-md" showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>{ui('Rename API key')}</DialogTitle>
          <DialogDescription className="break-words">{apiKey.name}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save() }}>
          <div className="space-y-1.5">
            <Label htmlFor="rename-key-name">{ui('Name')}</Label>
            <Input id="rename-key-name" value={name} maxLength={120} autoFocus disabled={saving}
              onChange={(event) => setName(event.target.value)} />
          </div>
          {failed && <p role="alert" className="text-sm text-destructive">{ui('Could not rename this key. Please try again.')}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>{ui('Cancel')}</Button>
            <Button type="submit" disabled={saving || !canSave}>{saving ? ui('Saving…') : ui('Save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type ApiKeyModel = { id: string; name: string }

export function ApiKeyModelsDialog({ apiKey, onClose }: { apiKey: ApiKey; onClose: () => void }) {
  const [models, setModels] = useState<ApiKeyModel[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [copyFailed, setCopyFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)
    void apiRequest<{ data: ApiKeyModel[] }>(`/api/api-keys/${apiKey.id}/models`, { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setModels(response.data) })
      .catch(() => { if (!controller.signal.aborted) setFailed(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [apiKey.id, attempt])

  useEffect(() => {
    if (!copied) return
    const timeout = setTimeout(() => setCopied(null), 1500)
    return () => clearTimeout(timeout)
  }, [copied])

  const copy = async (id: string) => {
    setCopyFailed(false)
    try {
      await navigator.clipboard.writeText(id)
      setCopied(id)
    } catch {
      setCopyFailed(true)
    }
  }

  const search = query.trim().toLowerCase()
  const filtered = models.filter((model) => model.name.toLowerCase().includes(search) || model.id.toLowerCase().includes(search))

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{ui('Model access')}</DialogTitle>
          <DialogDescription className="break-words">{uit`Models available to “${apiKey.name}”. Use the API ID in the model field of your requests.`}</DialogDescription>
        </DialogHeader>
        {apiKey.disabled && <p className="text-sm text-muted-foreground">{ui('This key is disabled. Enable it to use these models.')}</p>}
        {!apiKey.scopes.includes('responses') && <p className="text-sm text-muted-foreground">{ui('This key can list models but does not have inference access.')}</p>}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" aria-label={ui('Search models by name or API ID')} placeholder={ui('Search models by name or API ID')}
            value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        {loading ? <p role="status" className="py-6 text-center text-sm text-muted-foreground">{ui('Loading models…')}</p> : failed ? (
          <div className="space-y-3 py-6 text-center">
            <p role="alert" className="text-sm text-destructive">{ui('Could not load models for this key.')}</p>
            <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>{ui('Try again')}</Button>
          </div>
        ) : (
          <div className="max-h-[50dvh] overflow-y-auto rounded-lg border">
            {filtered.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">{models.length === 0 ? ui('No models are currently available to this key.') : ui('No models match your search.')}</p>
            ) : (
              <ul className="divide-y">
                {filtered.map((model) => (
                  <li key={model.id} className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium">{model.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{ui('API ID')}: <code className="break-all select-text font-mono">{model.id}</code></p>
                    </div>
                    <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label={uit`Copy API ID for ${model.name}`} onClick={() => void copy(model.id)}>
                      {copied === model.id ? <Check className="size-4" /> : <Copy className="size-4" />}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p role="status" className="sr-only">{copied ? ui('Copied') : ''}</p>
        {copyFailed && <p role="alert" className="text-sm text-destructive">{ui('Could not copy the API ID. Select and copy it manually.')}</p>}
        <DialogFooter><Button variant="outline" onClick={onClose}>{ui('Done')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
