import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/i18n'
import { MessageList } from '../../src/components/chat/MessageList'
import { ScrollArea } from '../../src/components/ui/scroll-area'
import { useChat, type ServerChat, type ServerResponse } from '../../src/stores/chat'
import { useAuth } from '../../src/stores/auth'
import { queryClient } from '../../src/lib/query-client'

const params = new URLSearchParams(location.search)
const count = Number(params.get('turns') ?? 1000)
const rich = params.has('rich')
const countFor = (chatId: string) => chatId === 'two' ? Number(params.get('otherTurns') ?? count) : count
const pageSize = Number(params.get('page') ?? Infinity)
const activeVersions = new Map<string, string>()
const timestamp = '2026-09-24T12:00:00.000Z'
const userId = 'switching-benchmark'
useAuth.setState({ user: { id: userId } as NonNullable<ReturnType<typeof useAuth.getState>['user']> })

function response(chatId: string, index: number, alternate = false): ServerResponse {
  const id = `${chatId}-${index}${alternate ? '-alt' : ''}`
  const text = `Answer ${id}. ` + (rich
    ? 'Some **formatted text** with a [link](https://example.com).\n\n| Item | Value |\n|---|---|\n| First | 1 |\n\n```typescript\nconst answer = 42\n```\n'
    : 'The cached transcript should remain visible while changing versions.\n\n')
  const output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }]
  const siblings = index === countFor(chatId) - 1 ? [`${chatId}-${index}`, `${chatId}-${index}-alt`] : [id]
  return {
    id, parentResponseId: index ? `${chatId}-${index - 1}` : null, userMessageId: `input-${chatId}-${index}`,
    modelId: 'benchmark', status: 'completed', input: [{ role: 'user', content: [{ type: 'input_text', text: `Question ${index}` }] }],
    output, presetSelections: {}, usage: null, error: null, createdAt: timestamp, completedAt: timestamp,
    snapshot: { responseId: id, status: 'completed', sequence: 1, output, usage: null, error: null, updatedAt: timestamp },
    branches: { user: { ids: [id], index: 0 }, assistant: { ids: siblings, index: alternate ? 1 : 0 } },
  }
}

function detail(chatId: string, selected = activeVersions.get(chatId) ?? `${chatId}-${countFor(chatId) - 1}`, before?: string): ServerChat {
  const last = Number(selected.split('-')[1])
  const end = before ? Number(before.split('-')[1]) : last + 1
  const start = Math.max(0, end - pageSize)
  const responses = Array.from({ length: end - start }, (_, i) => response(chatId, start + i, selected.endsWith('-alt') && start + i === last))
  const leafId = selected
  return {
    id: chatId, title: chatId, modelId: 'benchmark', pinned: false, folderId: null, createdAt: timestamp, updatedAt: timestamp,
    activeResponseId: leafId, activeBranchLeafId: leafId, responses, attachments: [],
    history: { offset: start, hasMore: start > 0, before: responses[0]!.id, leafId },
  }
}
for (const id of ['one', 'two']) {
  const chat = detail(id)
  queryClient.setQueryData(['chat', userId, id], chat)
  useChat.getState().setDetailedChat(chat)
}

// Only the transport is synthetic: render and switch using the production store/list/rows.
const originalFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = String(input)
  if (url.includes('/activate')) {
    await new Promise(resolve => setTimeout(resolve, Number(params.get('latency') ?? 200)))
    const id = url.split('/messages/')[1]!.split('/')[0]!
    const chatId = id.startsWith('one-') ? 'one' : 'two'
    activeVersions.set(chatId, id)
    const chat = detail(chatId, id)
    return new Response(JSON.stringify(chat), { headers: { 'content-type': 'application/json' } })
  }
  if (url.includes('/api/chats/')) {
    const parsed = new URL(url, location.origin)
    const chatId = parsed.pathname.split('/').at(-1)!
    return new Response(JSON.stringify(detail(chatId, undefined, parsed.searchParams.get('before') ?? undefined)), { headers: { 'content-type': 'application/json' } })
  }
  return originalFetch(input, init)
}
const noop = () => {}
export function Fixture() {
  const [active, setActive] = useState('one')
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const chat = useChat(state => state.chats.find(chat => chat.id === active)!)
  return <main className="flex h-screen flex-col">
    <nav className="flex gap-4 p-2">
      <button onClick={() => setActive('one')}>Thread one</button><button onClick={() => setActive('two')}>Thread two</button>
      {params.has('checks') && <>
        <button onClick={() => useChat.getState().activateBranch(active, `${active}-${countFor(active) - 6}-alt`)}>Short branch</button>
        <button onClick={() => useChat.getState().activateBranch(active, `${active}-${countFor(active) - 1}`)}>Original branch</button>
        <button onClick={() => {
          const row = response(active, countFor(active) - 1)
          useChat.getState().applyResponseSnapshot({ ...row.snapshot, sequence: 2, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Updated answer\n\n'.repeat(40) }] }] })
        }}>Grow answer</button>
      </>}
    </nav>
    <ScrollArea className="min-h-0 flex-1" viewportRef={setViewport}>
      <div className="mx-auto w-full max-w-5xl min-w-0 px-4">{viewport && <MessageList chat={chat} viewport={viewport} onRegenerate={noop} />}</div>
    </ScrollArea>
    <textarea aria-label="Draft" className="m-4 border p-4" defaultValue="Preserve this draft" />
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
