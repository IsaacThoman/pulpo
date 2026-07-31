import type {
  Chat,
  ChatPreset,
  Folder,
  Message,
  Model,
  MonitorUser,
  UsageRecord,
} from './types'

// Deterministic PRNG so mock data is stable between reloads
export function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function reasoningPreset(...levels: string[]): ChatPreset {
  return {
    id: 'reasoning',
    name: 'Reasoning',
    icon: 'brain',
    defaultChoiceId: levels.includes('medium')
      ? 'medium'
      : levels.find((l) => l !== 'none') ?? levels[0],
    choices: levels.map((level) => ({
      id: level,
      displayName:
        level === 'none' ? 'Off' : `${level.charAt(0).toUpperCase()}${level.slice(1)}`,
      action:
        level === 'none'
          ? { type: 'none' as const }
          : {
              type: 'params' as const,
              params: { reasoning_effort: level },
            },
    })),
  }
}

function speedPreset(opts: { standard?: boolean; fastRedirect?: string } = {}): ChatPreset {
  const choices: ChatPreset['choices'] = []
  if (opts.standard !== false) {
    choices.push({
      id: 'standard',
      displayName: 'Standard',
      icon: 'zap-off',
      action: { type: 'none' },
    })
  }
  if (opts.fastRedirect) {
    choices.push({
      id: 'fast',
      displayName: 'Fast',
      icon: 'zap',
      action: { type: 'redirect', modelId: opts.fastRedirect },
    })
  } else {
    choices.push({
      id: 'fast',
      displayName: 'Fast',
      icon: 'zap',
      action: { type: 'params', params: { service_tier: 'priority' } },
    })
  }
  return {
    id: 'speed',
    name: 'Speed',
    icon: 'gauge',
    defaultChoiceId: 'standard',
    choices,
  }
}

export const MODELS: Model[] = [
  {
    id: 'example-model',
    name: 'Example model',
    provider: 'Moonshot AI',
    labLogo: 'moonshot',
    modelLogo: 'moonshot',
    inferenceProvider: 'Fireworks',
    description: 'Flagship reasoning model with long context and agentic tool use.',
    contextWindow: 262144,
    tags: ['reasoning', 'tools', 'code'],
    iconLight: '#18181b',
    iconDark: '#fafafa',
    inputPrice: 0.6,
    outputPrice: 2.5,
    perMessagePrice: 0,
    enabled: true,
    pinned: true,
    presets: [reasoningPreset('low', 'medium', 'high'), speedPreset()],
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    labLogo: 'openai',
    modelLogo: 'openai',
    inferenceProvider: 'Azure (US)',
    description: 'Omni multimodal flagship — fast, capable, great all-rounder.',
    contextWindow: 128000,
    tags: ['vision', 'tools'],
    iconLight: '#0f766e',
    iconDark: '#2dd4bf',
    inputPrice: 2.5,
    outputPrice: 10,
    perMessagePrice: 0,
    enabled: true,
    pinned: true,
    presets: [speedPreset()],
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    provider: 'OpenAI',
    labLogo: 'openai',
    modelLogo: 'openai',
    inferenceProvider: 'Azure (US)',
    description: 'Small, cheap and fast for everyday tasks.',
    contextWindow: 128000,
    tags: ['vision', 'fast'],
    iconLight: '#059669',
    iconDark: '#34d399',
    inputPrice: 0.15,
    outputPrice: 0.6,
    perMessagePrice: 0,
    enabled: true,
    presets: [],
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    provider: 'Anthropic',
    labLogo: 'anthropic',
    modelLogo: 'claude-color',
    inferenceProvider: 'Amazon Bedrock (US)',
    description: 'Balanced coding and writing model with sharp reasoning.',
    contextWindow: 200000,
    tags: ['vision', 'code', 'tools'],
    iconLight: '#c2410c',
    iconDark: '#fb923c',
    inputPrice: 3,
    outputPrice: 15,
    perMessagePrice: 0,
    enabled: true,
    pinned: true,
    presets: [speedPreset()],
  },
  {
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    provider: 'DeepSeek',
    labLogo: 'deepseek',
    modelLogo: 'deepseek-color',
    inferenceProvider: 'Fireworks',
    description: 'Open reasoning model that thinks out loud before answering.',
    contextWindow: 65536,
    tags: ['reasoning', 'code'],
    iconLight: '#1d4ed8',
    iconDark: '#60a5fa',
    inputPrice: 0.55,
    outputPrice: 2.19,
    perMessagePrice: 0,
    enabled: true,
    presets: [reasoningPreset('low', 'medium', 'high'), speedPreset()],
  },
  {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    provider: 'Meta',
    labLogo: 'meta',
    modelLogo: 'meta-color',
    inferenceProvider: 'Fireworks',
    description: 'Open-weight workhorse for general chat and summarization.',
    contextWindow: 131072,
    tags: ['fast', 'tools'],
    iconLight: '#7c3aed',
    iconDark: '#a78bfa',
    inputPrice: 0.12,
    outputPrice: 0.3,
    perMessagePrice: 0,
    enabled: true,
    presets: [speedPreset()],
  },
  {
    id: 'qwen3-235b',
    name: 'Qwen3 235B',
    provider: 'Alibaba',
    labLogo: 'alibaba',
    modelLogo: 'qwen-color',
    inferenceProvider: 'Fireworks',
    description: 'Huge MoE model with hybrid thinking modes.',
    contextWindow: 131072,
    tags: ['reasoning', 'tools', 'code'],
    iconLight: '#be185d',
    iconDark: '#f472b6',
    inputPrice: 0.2,
    outputPrice: 0.88,
    perMessagePrice: 0,
    enabled: true,
    presets: [reasoningPreset('none', 'low', 'medium', 'high'), speedPreset()],
  },
  {
    id: 'mistral-large',
    name: 'Mistral Large',
    provider: 'Mistral',
    labLogo: 'mistral',
    modelLogo: 'mistral-color',
    inferenceProvider: 'Azure (US)',
    description: 'European flagship, strong multilingual performance.',
    contextWindow: 131072,
    tags: ['tools'],
    iconLight: '#b45309',
    iconDark: '#fbbf24',
    inputPrice: 2,
    outputPrice: 6,
    perMessagePrice: 0,
    enabled: false,
    presets: [],
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'Google',
    labLogo: 'google',
    modelLogo: 'gemini-color',
    inferenceProvider: 'Google AI',
    description: 'Google’s multimodal reasoning model for complex analysis and coding.',
    contextWindow: 1048576,
    tags: ['vision', 'reasoning', 'tools', 'code'],
    iconLight: '#2563eb',
    iconDark: '#60a5fa',
    inputPrice: 1.25,
    outputPrice: 10,
    perMessagePrice: 0,
    enabled: true,
    presets: [reasoningPreset('low', 'medium', 'high')],
  },
  {
    id: 'grok-4',
    name: 'Grok 4',
    provider: 'xAI',
    labLogo: 'xai',
    modelLogo: 'grok',
    inferenceProvider: 'xAI',
    description: 'xAI’s flagship reasoning model with tools and broad knowledge.',
    contextWindow: 256000,
    tags: ['vision', 'reasoning', 'tools', 'code'],
    iconLight: '#18181b',
    iconDark: '#fafafa',
    inputPrice: 3,
    outputPrice: 15,
    perMessagePrice: 0,
    enabled: true,
    presets: [reasoningPreset('low', 'high'), speedPreset()],
  },
]

export function getModel(id: string): Model {
  return MODELS.find((m) => m.id === id) ?? MODELS[0]
}

// ---------------------------------------------------------------------------
// Mock conversation content
// ---------------------------------------------------------------------------

const ASSISTANT_MD = `Here's a quick breakdown of the approach:

The key insight is to **separate the streaming layer from state**. Zustand works well here because updates are granular — each token append only re-renders the active message.

\`\`\`ts
const stream = useChatStore((s) => s.streamingMessageId)
const append = useChatStore((s) => s.appendToken)

for await (const chunk of response) {
  append(stream, chunk.delta)
}
\`\`\`

A few things worth noting:

1. **Backpressure** — flush on animation frames rather than per-token to keep 60fps.
2. **Markdown** — render incrementally with \`react-markdown\`; it's fast enough for typical lengths.
3. **Cancellation** — keep an \`AbortController\` per message so the stop button is instant.

> The naive approach of re-rendering the whole list per token will drop frames past ~2k tokens. Granular selectors fix that.

Want me to sketch the reducer shape as well?`

const ASSISTANT_REASONING_MD = `Good question — this touches on a common misconception.

**Short answer:** you don't need one. For a UI mockup, simulating latency with a local generator is more faithful anyway, because you control token timing exactly.

The tradeoffs:

- **Real API**: realistic text, but costs money, needs keys, and fails offline.
- **Local generator**: deterministic, instant, and lets you test edge cases (huge outputs, mid-stream aborts) on demand.

\`\`\`ts
function* fakeStream(text: string, chunk = 3) {
  for (let i = 0; i < text.length; i += chunk) {
    yield text.slice(i, i + chunk)
  }
}
\`\`\`

For production you'd swap the generator for an SSE reader and keep everything else identical.`

const USER_PROMPTS = [
  'How should I structure streaming state in a React chat app?',
  'Do I need a real backend to prototype token streaming?',
  'Explain the difference between SSE and WebSockets for LLM streaming',
  'Write a haiku about gradient descent',
  'Review this zustand store shape — does it normalize too much?',
  'What causes scroll jitter during streaming and how do I fix it?',
  'Compare react-markdown vs. remark-rehype pipeline performance',
  'How do I implement message branching like ChatGPT?',
  'Design a folder system for organizing chats',
  'What is a reasonable retry policy for flaky completions?',
  'Help me name a sidebar component that also does search',
  'Is optimistic UI worth it for message sends?',
  'Draft release notes for v0.4 of our chat client',
  'How do tokenizers count emoji?',
  'Best practices for a Cmd+K palette in 2026',
  'What accessibility attributes does a chat log need?',
]

function makeMessages(rand: () => number, modelId: string, count: number): Message[] {
  const msgs: Message[] = []
  const model = getModel(modelId)
  let t = Date.now() - Math.floor(rand() * 20) * 86_400_000
  for (let i = 0; i < count; i++) {
    t += Math.floor(rand() * 3600_000)
    const tokensIn = 30 + Math.floor(rand() * 400)
    msgs.push({
      id: crypto.randomUUID(),
      role: 'user',
      content: USER_PROMPTS[Math.floor(rand() * USER_PROMPTS.length)],
      timestamp: t,
      tokensIn,
      done: true,
    })
    t += 2000 + Math.floor(rand() * 20000)
    const tokensOut = 150 + Math.floor(rand() * 900)
    const isReasoner = model.tags.includes('reasoning')
    msgs.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: i % 2 === 0 ? ASSISTANT_MD : ASSISTANT_REASONING_MD,
      modelId,
      timestamp: t,
      tokensIn,
      tokensOut,
      cost: (tokensIn * model.inputPrice + tokensOut * model.outputPrice) / 1_000_000,
      latencyMs: 1200 + Math.floor(rand() * 6000),
      reasoning: isReasoner
        ? 'The user is asking about implementation tradeoffs. I should lead with the practical answer, then give the tradeoff table. Keep it concise, use a code sample, avoid hedging.'
        : undefined,
      done: true,
    })
  }
  return msgs
}

const CHAT_TITLES = [
  'Streaming state architecture',
  'SSE vs WebSockets',
  'Message branching design',
  'Cmd+K palette patterns',
  'Tokenizer edge cases',
  'Scroll anchoring fix',
  'Zustand store review',
  'Folder system design',
  'Retry policy draft',
  'Release notes v0.4',
  'Optimistic sends',
  'Chat log a11y',
  'Markdown perf notes',
  'Sidebar search naming',
  'Gradient descent haiku',
  'AbortController wiring',
]

export function makeMockChats(): { chats: Chat[]; folders: Folder[] } {
  const rand = mulberry32(1337)
  const folders: Folder[] = [
    { id: 'f-work', name: 'work', expanded: true },
    { id: 'f-research', name: 'research', expanded: true },
    { id: 'f-shitposts', name: 'shitposts', expanded: false },
  ]
  const chats: Chat[] = []
  const now = Date.now()
  CHAT_TITLES.forEach((title, i) => {
    const modelId = MODELS[Math.floor(rand() * 7)].id
    const updatedAt = now - Math.floor(rand() * rand() * 45) * 86_400_000 - i * 3_600_000
    const createdAt = updatedAt - Math.floor(rand() * 10) * 86_400_000
    chats.push({
      id: `chat-${i}`,
      title,
      modelId,
      messages: makeMessages(rand, modelId, 2 + Math.floor(rand() * 6)),
      createdAt,
      updatedAt,
      pinned: i < 2,
      folderId: i % 5 === 1 ? folders[i % 3].id : null,
      tags: i % 4 === 0 ? ['dev'] : i % 7 === 0 ? ['writing'] : [],
    })
  })
  return { chats, folders }
}

// ---------------------------------------------------------------------------
// Monitor mock data (OpenWebUI-Monitor)
// ---------------------------------------------------------------------------

export const MONITOR_USERS: MonitorUser[] = [
  { id: 'u-isaac', name: 'Isaac Thoman', nickname: null, email: 'isaac@pulpo.dev', role: 'admin', balance: 84.12, joinedAt: Date.now() - 340 * 86_400_000, blocked: false, showOnLeaderboard: true, barColor: '#fafafa' },
  { id: 'u-maya', name: 'Maya Chen', nickname: 'myc', email: 'maya@pulpo.dev', role: 'user', balance: 31.77, joinedAt: Date.now() - 290 * 86_400_000, blocked: false, showOnLeaderboard: true, barColor: '#60a5fa' },
  { id: 'u-jonas', name: 'Jonas Weber', nickname: null, email: 'jonas@pulpo.dev', role: 'user', balance: 12.04, joinedAt: Date.now() - 210 * 86_400_000, blocked: false, showOnLeaderboard: true, barColor: '#34d399' },
  { id: 'u-priya', name: 'Priya Nair', nickname: 'pri', email: 'priya@pulpo.dev', role: 'user', balance: 55.9, joinedAt: Date.now() - 180 * 86_400_000, blocked: false, showOnLeaderboard: false, barColor: '#f472b6' },
  { id: 'u-tom', name: 'Tom Alvarez', nickname: null, email: 'tom@pulpo.dev', role: 'user', balance: 0.42, joinedAt: Date.now() - 96 * 86_400_000, blocked: false, showOnLeaderboard: true, barColor: '#fbbf24' },
  { id: 'u-elena', name: 'Elena Rossi', nickname: null, email: 'elena@pulpo.dev', role: 'user', balance: 23.31, joinedAt: Date.now() - 64 * 86_400_000, blocked: true, showOnLeaderboard: false, barColor: '#a78bfa' },
  { id: 'u-sam', name: 'Sam Okafor', nickname: 'sammo', email: 'sam@pulpo.dev', role: 'user', balance: 47.65, joinedAt: Date.now() - 30 * 86_400_000, blocked: false, showOnLeaderboard: true, barColor: '#fb923c' },
]

export const CURRENT_USER_ID = 'u-isaac'

export function makeUsageRecords(): UsageRecord[] {
  const rand = mulberry32(9001)
  const records: UsageRecord[] = []
  const now = Date.now()
  const me = MONITOR_USERS.find((u) => u.id === CURRENT_USER_ID)!
  let balance = 100
  for (let i = 0; i < 1400; i++) {
    // bias toward the current user so personal stats are dense
    const user = rand() < 0.32 ? me : MONITOR_USERS[Math.floor(rand() * MONITOR_USERS.length)]
    const model = MODELS[Math.floor(rand() * MODELS.length)]
    const tokensIn = 50 + Math.floor(rand() * 4000)
    const tokensOut = 100 + Math.floor(rand() * 2500)
    const cost = (tokensIn * model.inputPrice + tokensOut * model.outputPrice) / 1_000_000
    // more recent records are denser
    const age = Math.floor(Math.pow(rand(), 1.6) * 365) * 86_400_000 + Math.floor(rand() * 86_400_000)
    if (user.id === CURRENT_USER_ID) {
      balance = Math.max(0, balance - cost)
    }
    records.push({
      id: `rec-${i}`,
      timestamp: now - age,
      userId: user.id,
      modelId: model.id,
      tokensIn,
      tokensOut,
      cost,
      balanceAfter: user.id === CURRENT_USER_ID ? balance : 0,
      latencyMs: 800 + Math.floor(rand() * 9000),
    })
  }
  return records.sort((a, b) => b.timestamp - a.timestamp)
}

export interface DailyModelUsage {
  date: string // yyyy-mm-dd
  calls: number
  tokens: number
  cost: number
  models: { modelId: string; calls: number; tokens: number; cost: number }[]
}

/** Daily totals with a per-model breakdown, for stacked usage charts. */
export function makeDailyModelUsage(records: UsageRecord[], userId?: string): DailyModelUsage[] {
  const map = new Map<string, DailyModelUsage>()
  for (const r of records) {
    if (userId && r.userId !== userId) continue
    const d = new Date(r.timestamp)
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const day = map.get(date) ?? { date, calls: 0, tokens: 0, cost: 0, models: [] }
    day.calls += 1
    day.tokens += r.tokensIn + r.tokensOut
    day.cost += r.cost
    let m = day.models.find((x) => x.modelId === r.modelId)
    if (!m) {
      m = { modelId: r.modelId, calls: 0, tokens: 0, cost: 0 }
      day.models.push(m)
    }
    m.calls += 1
    m.tokens += r.tokensIn + r.tokensOut
    m.cost += r.cost
    map.set(date, day)
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export const REPLY_SUGGESTIONS = [
  'What can you help me build today?',
  'Explain how KV caching speeds up decoding',
  'Draft a terse commit message for a sidebar refactor',
  'Compare mixture-of-experts vs dense models',
]
