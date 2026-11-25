import { readSearchHandoff, type SearchHandoff } from '@pulpo/contracts/search'
import { ArrowUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ModelSelector } from '@/components/chat/ModelSelector'
import { ModelWarningBanner } from '@/components/chat/ModelWarningBanner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ui } from '@/i18n/ui'
import { useTranslation } from '@/i18n/useAppTranslation'
import { resolveDefaultModelId } from '@/lib/default-model'
import { useDocumentTitle } from '@/lib/document-title'
import { useAuth } from '@/stores/auth'
import { useCatalog } from '@/stores/catalog'
import { chatOptionsFor, resolveSelections, useModelConfig } from '@/stores/modelConfig'
import { useSettings } from '@/stores/settings'
import { useUploadOutbox } from '@/stores/upload-outbox'

export function SearchHandoffPage() {
  const { hash } = useLocation()
  const handoff = readSearchHandoff(hash)
  const title = ui('Ask Pulpo')
  useDocumentTitle(title)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 py-8 sm:py-12">
      <div className="mx-auto my-auto w-full max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {handoff ? (
          <SearchDraft key={hash} handoff={handoff} />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{ui('This search draft is missing or invalid.')}</p>
            <Button asChild variant="outline"><Link to="/">{ui('Open chat')}</Link></Button>
          </div>
        )}
      </div>
    </div>
  )
}

function SearchDraft({ handoff }: { handoff: SearchHandoff }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const models = useCatalog((state) => state.models)
  const catalogLoaded = useCatalog((state) => state.loaded)
  const agentAvailable = useCatalog((state) => state.agentAvailable)
  const defaultModelId = useSettings((state) => state.defaultModelId)
  const instanceReady = useAuth((state) => state.instanceReady)
  const [selectedModelId, setSelectedModelId] = useState('')
  const model = models.find((entry) => entry.enabled && entry.id === selectedModelId)
    ?? models.find((entry) => entry.enabled && entry.id === resolveDefaultModelId(models, defaultModelId))
  const [message, setMessage] = useState(() => [
    handoff.query,
    ui('Use these search results as starting points and cite the sources you consult.'),
    handoff.sources.map((url, index) => `${index + 1}. ${url}`).join('\n'),
  ].join('\n\n'))
  const submitted = useRef(false)
  const canSend = Boolean(model && instanceReady && message.trim())

  const send = () => {
    if (!model || !canSend || submitted.current) return
    submitted.current = true
    const settings = useSettings.getState()
    const options = chatOptionsFor(model, useModelConfig.getState().overrides)
    const staged = useUploadOutbox.getState().stageSubmission({
      chatId: null,
      content: message.trim(),
      modelId: model.id,
      presetSelections: resolveSelections(options, settings.generation[model.id]),
      agentMode: agentAvailable && model.agentEnabled === true && (settings.agentModes[model.id] ?? true),
      temporary: false,
      autoExpire: settings.automaticChatExpiration !== 'disabled' && settings.newChatAutoExpire,
      attachmentIds: [],
    })
    navigate(`/c/${staged.chatId}`, { replace: true })
  }

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4 shadow-xs sm:p-5">
      <Label htmlFor="pulpo-search-draft">{ui('New chat draft')}</Label>
      <p id="pulpo-search-draft-hint" className="text-sm text-muted-foreground">
        {ui('Edit the question and sources before sending.')}
      </p>
      <Textarea
        id="pulpo-search-draft"
        aria-describedby="pulpo-search-draft-hint"
        className="min-h-48 [overflow-wrap:anywhere]"
        rows={8}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
      />
      {model && <ModelWarningBanner modelId={model.id} onSelectModel={setSelectedModelId} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {model ? <ModelSelector value={model.id} onChange={setSelectedModelId} /> : (
          <p role="status" className="text-sm text-muted-foreground">{catalogLoaded ? t('chat.noModels') : t('common.loading')}</p>
        )}
        <Button type="button" onClick={send} disabled={!canSend}>
          <ArrowUp aria-hidden="true" /> {t('chat.sendMessage')}
        </Button>
      </div>
    </div>
  )
}
