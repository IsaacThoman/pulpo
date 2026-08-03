import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Bot } from 'lucide-react'
import { apiRequest } from '@/lib/api'

interface SharedResponse {
  id: string
  modelId: string
  status: string
  input: Array<{ role?: string; content?: string | Array<{ text?: string }> }>
  output: Array<{ type?: string; content?: Array<{ text?: string; refusal?: string }> }>
}

interface SharedChat {
  chat: { title: string }
  responses: SharedResponse[]
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => typeof part === 'string' ? part : ((part as { text?: string; refusal?: string }).text ?? (part as { refusal?: string }).refusal ?? '')).join('')
}

export function SharedChatPage() {
  const { token = '' } = useParams()
  const [share, setShare] = useState<SharedChat | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void apiRequest<SharedChat>(`/api/shares/${encodeURIComponent(token)}`)
      .then(setShare)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load this share'))
  }, [token])

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4">
          <Bot className="size-5" />
          <span className="font-semibold">Pulpo</span>
          <span className="text-muted-foreground">Shared chat</span>
          <div className="flex-1" />
          <Link className="text-sm text-muted-foreground hover:text-foreground" to="/">Open Pulpo</Link>
        </div>
      </header>
      <section className="mx-auto max-w-3xl space-y-7 px-4 py-8">
        {error && <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}
        {!share && !error && <p className="text-sm text-muted-foreground">Loading shared chat…</p>}
        {share && <>
          <h1 className="text-2xl font-semibold">{share.chat.title}</h1>
          {share.responses.flatMap((response) => {
            const user = [...response.input].reverse().find((item) => item.role === 'user')
            const answer = response.output.filter((item) => item.type === 'message').map((item) => contentText(item.content)).join('\n')
            return [
              <article key={`${response.id}:input`} className="ml-auto max-w-[85%] rounded-2xl bg-muted px-4 py-3 whitespace-pre-wrap">{contentText(user?.content)}</article>,
              <article key={response.id} className="prose prose-sm max-w-none whitespace-pre-wrap dark:prose-invert">{answer || (response.status === 'failed' ? 'This response failed.' : 'No text output.')}</article>,
            ]
          })}
        </>}
      </section>
    </main>
  )
}
