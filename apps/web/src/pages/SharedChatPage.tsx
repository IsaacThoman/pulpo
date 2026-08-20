import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, Loader2 } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { AiLogo } from '@/components/ProviderLogo'
import { Markdown } from '@/components/chat/Markdown'
import { timeAgo } from '@/lib/format'

interface SharedModel {
  id: string
  name: string
  logo: string
}

interface SharedResponse {
  id: string
  modelId: string
  model: SharedModel | null
  status: string
  input: Array<{ role?: string; content?: string | Array<{ text?: string }> }>
  output: Array<{ type?: string; content?: Array<{ text?: string; refusal?: string }> }>
  createdAt: string
}

export interface SharedChat {
  chat: { title: string; createdAt: string }
  responses: SharedResponse[]
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => typeof part === 'string'
    ? part
    : ((part as { text?: string; refusal?: string }).text ?? (part as { refusal?: string }).refusal ?? '')).join('')
}

function responseText(response: SharedResponse): string {
  return response.output
    .filter((item) => item.type === 'message')
    .map((item) => contentText(item.content))
    .filter(Boolean)
    .join('\n\n')
}

function SharedResponseView({ response }: { response: SharedResponse }) {
  const user = [...response.input].reverse().find((item) => item.role === 'user')
  const prompt = contentText(user?.content)
  const answer = responseText(response)
  const modelName = response.model?.name ?? response.modelId

  return (
    <div className="contents">
      {prompt && (
        <article className="group flex min-w-0 max-w-full flex-col items-end gap-1">
          <div className="min-w-0 max-w-[85%] rounded-[1.25rem] rounded-br-md border border-foreground/[0.04] bg-secondary/85 px-4 py-2.5 text-[15px] leading-7 shadow-sm [overflow-wrap:anywhere]">
            <Markdown content={prompt} />
          </div>
        </article>
      )}

      <article className="flex min-w-0 max-w-full gap-3">
        <AiLogo icon={response.model?.logo ?? 'pulpo'} className="mt-1 size-7 rounded-[4px]" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 truncate text-sm font-semibold">{modelName}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {timeAgo(new Date(response.createdAt).getTime())}
            </span>
          </div>
          <div className="mt-1 min-w-0 max-w-full text-[15px]">
            <Markdown content={answer || (response.status === 'failed' ? 'This response failed.' : 'No text output.')} />
          </div>
        </div>
      </article>
    </div>
  )
}

export function SharedChatView({ share }: { share: SharedChat }) {
  return (
    <>
      <header className="sticky top-0 z-20 shrink-0 border-b bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-12 w-full max-w-5xl items-center gap-2 px-4">
          <Link to="/" className="flex shrink-0 items-center gap-2 rounded-lg font-semibold hover:opacity-80">
            <img src="/pulpo-smiley.png" alt="Pulpo" className="size-6" />
            <span className="hidden sm:inline">Pulpo</span>
          </Link>
          <div className="flex-1" />
          <Link className="hidden shrink-0 text-sm text-muted-foreground hover:text-foreground sm:block" to="/">
            Open Pulpo
          </Link>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-7 px-4 py-6">
        <h1 className="text-2xl font-semibold tracking-tight">{share.chat.title}</h1>
        {share.responses.map((response) => <SharedResponseView key={response.id} response={response} />)}
        {share.responses.length === 0 && (
          <div className="grid flex-1 place-items-center py-24 text-sm text-muted-foreground">This shared chat has no messages.</div>
        )}
      </section>

      <footer className="border-t bg-muted/20 px-4 py-4 text-center text-xs text-muted-foreground">
        Public, read-only chat shared from Pulpo. Reasoning is not included.
      </footer>
    </>
  )
}

export function SharedChatPage() {
  const { token = '' } = useParams()
  const [share, setShare] = useState<SharedChat | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setShare(null)
    setError('')
    void apiRequest<SharedChat>(`/api/shares/${encodeURIComponent(token)}`)
      .then((result) => { if (!cancelled) setShare(result) })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load this shared chat')
      })
    return () => { cancelled = true }
  }, [token])

  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      {!share && !error && (
        <div role="status" className="grid flex-1 place-items-center px-6 py-16 text-sm text-muted-foreground">
          <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading shared chat…</span>
        </div>
      )}
      {error && (
        <div className="grid flex-1 place-items-center px-6 py-16 text-center">
          <div className="max-w-sm">
            <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"><AlertCircle className="size-5" /></span>
            <h1 className="mt-4 text-lg font-semibold">Shared chat unavailable</h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{error}</p>
            <Link to="/" className="mt-5 inline-block text-sm font-medium text-primary hover:underline">Open Pulpo</Link>
          </div>
        </div>
      )}
      {share && <SharedChatView share={share} />}
    </main>
  )
}
