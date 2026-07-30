import { create } from 'zustand'
import type { Chat, Folder, Message, ReasoningEffort, SpeedOption } from '@/lib/types'
import { getModel, makeMockChats, MODELS } from '@/lib/mock'
import { chatOptionsFor, resolveGeneration, useModelConfig } from '@/stores/modelConfig'
import { useSettings } from '@/stores/settings'

const seed = makeMockChats()

const STREAM_BUFFER = `Here is how I would approach it:

The trick is to treat the stream as a **single writer** and let React subscribe to slices. Each appended token updates one message object; selectors keep everything else still.

\`\`\`ts
appendToken(messageId, delta) {
  set((s) => ({
    chats: s.chats.map((c) =>
      c.id === chatId
        ? { ...c, messages: patchMessage(c.messages, messageId, delta) }
        : c
    ),
  }))
}
\`\`\`

Key points:

1. **Immutable patches** keep memoization honest — only the active bubble re-renders.
2. **Scroll anchoring** belongs in the list component, not the store.
3. Persist to \`localStorage\` on a 500ms debounce so a refresh mid-stream loses nothing.

> This mock generates text locally, but the store shape wouldn't change against a real SSE endpoint.

Want me to go deeper on any of these?`

const REASONING_TEXT =
  'The user sent a new message. I should answer with something concrete and technical, matching the tone of the conversation so far. A short structure with a code sample lands well here. Keep it under ~150 words of prose.'

const REASONING_TEXT_HIGH =
  REASONING_TEXT +
  ' Let me also weigh the alternatives: a normalized store would simplify updates but complicate streaming appends, while a flat map by message id would need extra indexing per chat. The slice-subscription approach avoids both pitfalls. Double-checking the abort path: clearing the interval and marking the message done is enough, since the buffer is local.'

interface GenerationSelection {
  reasoningEffort?: ReasoningEffort
  speed?: SpeedOption
}

/** Current composer selection for a model: saved user prefs validated against admin-allowed options. */
function generationFor(modelId: string): GenerationSelection {
  const model = getModel(modelId)
  const options = chatOptionsFor(model, useModelConfig.getState().overrides)
  return resolveGeneration(options, useSettings.getState().generation[modelId])
}

function reasoningTextFor(effort: ReasoningEffort | undefined): string | undefined {
  if (effort === 'none') return undefined
  if (effort === 'low') return REASONING_TEXT.slice(0, 90) + '…'
  if (effort === 'high') return REASONING_TEXT_HIGH
  return REASONING_TEXT
}

interface ChatState {
  chats: Chat[]
  folders: Folder[]
  activeChatId: string | null
  streamingId: string | null // message id currently streaming
  abort: (() => void) | null
  // selectors-ish helpers
  newChat: (modelId?: string) => string
  setActive: (id: string | null) => void
  deleteChat: (id: string) => void
  renameChat: (id: string, title: string) => void
  togglePin: (id: string) => void
  moveToFolder: (id: string, folderId: string | null) => void
  shareChat: (id: string) => void
  addFolder: (name: string) => void
  toggleFolder: (id: string) => void
  deleteFolder: (id: string) => void
  sendMessage: (chatId: string | null, content: string, modelId: string) => string
  regenerate: (chatId: string, messageId: string) => void
  editUserMessage: (chatId: string, messageId: string, content: string) => void
  stopStreaming: () => void
  rateMessage: (chatId: string, messageId: string, rating: 'up' | 'down' | null) => void
}

let streamTimer: ReturnType<typeof setInterval> | null = null

function patchMessage(messages: Message[], id: string, fn: (m: Message) => Message): Message[] {
  return messages.map((m) => (m.id === id ? fn(m) : m))
}

export const useChat = create<ChatState>()((set, get) => {
  function startStreaming(
    chatId: string,
    messageId: string,
    modelId: string,
    gen: GenerationSelection
  ) {
    const model = getModel(modelId)
    const reasoningTarget =
      model.tags.includes('reasoning') || gen.reasoningEffort
        ? reasoningTextFor(gen.reasoningEffort)
        : undefined
    let pos = 0
    let reasoningDone = reasoningTarget === undefined
    let rpos = 0
    const started = Date.now()
    const tickMs = gen.speed === 'fast' ? 10 : 24

    const tick = () => {
      const state = get()
      if (state.streamingId !== messageId) {
        if (streamTimer) clearInterval(streamTimer)
        return
      }
      set((s) => ({
        chats: s.chats.map((c) => {
          if (c.id !== chatId) return c
          return {
            ...c,
            updatedAt: Date.now(),
            messages: patchMessage(c.messages, messageId, (m) => {
              if (!reasoningDone) {
                rpos += 2 + Math.floor(Math.random() * 3)
                const reasoning = reasoningTarget!.slice(0, rpos)
                if (rpos >= reasoningTarget!.length) reasoningDone = true
                return { ...m, reasoning }
              }
              pos += 2 + Math.floor(Math.random() * 5)
              const content = STREAM_BUFFER.slice(0, pos)
              const tokensOut = Math.ceil(pos / 4)
              if (pos >= STREAM_BUFFER.length) {
                if (streamTimer) clearInterval(streamTimer)
                const latencyMs = Date.now() - started
                const tokensIn = 128
                const cost = (tokensIn * model.inputPrice + tokensOut * model.outputPrice) / 1_000_000
                queueMicrotask(() => set({ streamingId: null, abort: null }))
                return { ...m, content, done: true, tokensIn, tokensOut, cost, latencyMs }
              }
              return { ...m, content, tokensOut }
            }),
          }
        }),
      }))
    }
    streamTimer = setInterval(tick, tickMs)
    set({
      streamingId: messageId,
      abort: () => {
        if (streamTimer) clearInterval(streamTimer)
        set((s) => ({
          streamingId: null,
          abort: null,
          chats: s.chats.map((c) =>
            c.id === chatId
              ? { ...c, messages: patchMessage(c.messages, messageId, (m) => ({ ...m, done: true })) }
              : c
          ),
        }))
      },
    })
  }

  return {
    chats: seed.chats,
    folders: seed.folders,
    activeChatId: null,
    streamingId: null,
    abort: null,

    newChat: (modelId) => {
      set({ activeChatId: null })
      return modelId ?? MODELS[0].id
    },
    setActive: (id) => set({ activeChatId: id }),

    deleteChat: (id) =>
      set((s) => ({
        chats: s.chats.filter((c) => c.id !== id),
        activeChatId: s.activeChatId === id ? null : s.activeChatId,
      })),

    renameChat: (id, title) =>
      set((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...c, title } : c)) })),

    togglePin: (id) =>
      set((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)) })),

    moveToFolder: (id, folderId) =>
      set((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...c, folderId } : c)) })),

    shareChat: (id) =>
      set((s) => ({
        chats: s.chats.map((c) => (c.id === id ? { ...c, shareId: crypto.randomUUID() } : c)),
      })),

    addFolder: (name) =>
      set((s) => ({
        folders: [...s.folders, { id: `f-${crypto.randomUUID()}`, name, expanded: true }],
      })),

    toggleFolder: (id) =>
      set((s) => ({
        folders: s.folders.map((f) => (f.id === id ? { ...f, expanded: !f.expanded } : f)),
      })),

    deleteFolder: (id) =>
      set((s) => ({
        folders: s.folders.filter((f) => f.id !== id),
        chats: s.chats.map((c) => (c.folderId === id ? { ...c, folderId: null } : c)),
      })),

    sendMessage: (chatId, content, modelId) => {
      const now = Date.now()
      const gen = generationFor(modelId)
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        timestamp: now,
        done: true,
      }
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        modelId,
        timestamp: now + 1,
        reasoning: getModel(modelId).tags.includes('reasoning') && gen.reasoningEffort !== 'none' ? '' : undefined,
        reasoningEffort: gen.reasoningEffort,
        speed: gen.speed,
        done: false,
      }
      let id = chatId
      if (!id) {
        id = `chat-${crypto.randomUUID()}`
        const title = content.length > 42 ? `${content.slice(0, 42)}…` : content
        const chat: Chat = {
          id,
          title,
          modelId,
          messages: [userMsg, assistantMsg],
          createdAt: now,
          updatedAt: now,
          pinned: false,
          folderId: null,
          tags: [],
        }
        set((s) => ({ chats: [chat, ...s.chats], activeChatId: id }))
      } else {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === id
              ? { ...c, updatedAt: now, messages: [...c.messages, userMsg, assistantMsg] }
              : c
          ),
        }))
      }
      startStreaming(id, assistantMsg.id, modelId, gen)
      return id
    },

    regenerate: (chatId, messageId) => {
      const state = get()
      const chat = state.chats.find((c) => c.id === chatId)
      const msg = chat?.messages.find((m) => m.id === messageId)
      if (!chat || !msg || state.streamingId) return
      const modelId = msg.modelId ?? chat.modelId
      const gen = generationFor(modelId)
      set((s) => ({
        chats: s.chats.map((c) =>
          c.id === chatId
            ? {
                ...c,
                messages: patchMessage(c.messages, messageId, (m) => ({
                  ...m,
                  content: '',
                  reasoning:
                    getModel(modelId).tags.includes('reasoning') && gen.reasoningEffort !== 'none'
                      ? ''
                      : undefined,
                  reasoningEffort: gen.reasoningEffort,
                  speed: gen.speed,
                  done: false,
                  rating: null,
                })),
              }
            : c
        ),
      }))
      startStreaming(chatId, messageId, modelId, gen)
    },

    editUserMessage: (chatId, messageId, content) => {
      const state = get()
      const chat = state.chats.find((c) => c.id === chatId)
      if (!chat || state.streamingId) return
      const idx = chat.messages.findIndex((m) => m.id === messageId)
      if (idx === -1) return
      // truncate after the edited message, then re-answer
      const gen = generationFor(chat.modelId)
      const kept = chat.messages.slice(0, idx + 1).map((m) => (m.id === messageId ? { ...m, content } : m))
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        modelId: chat.modelId,
        timestamp: Date.now(),
        reasoning: getModel(chat.modelId).tags.includes('reasoning') && gen.reasoningEffort !== 'none' ? '' : undefined,
        reasoningEffort: gen.reasoningEffort,
        speed: gen.speed,
        done: false,
      }
      set((s) => ({
        chats: s.chats.map((c) =>
          c.id === chatId ? { ...c, messages: [...kept, assistantMsg], updatedAt: Date.now() } : c
        ),
      }))
      startStreaming(chatId, assistantMsg.id, chat.modelId, gen)
    },

    stopStreaming: () => get().abort?.(),

    rateMessage: (chatId, messageId, rating) =>
      set((s) => ({
        chats: s.chats.map((c) =>
          c.id === chatId
            ? { ...c, messages: patchMessage(c.messages, messageId, (m) => ({ ...m, rating })) }
            : c
        ),
      })),
  }
})
