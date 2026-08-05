import type { PersistedPrototypeState, PrototypeChat, PrototypeModel } from './domain';

const now = Date.now();
const hour = 60 * 60 * 1000;
const day = 24 * hour;

export const seedModels: PrototypeModel[] = [
  {
    id: 'claude-sonnet-4', name: 'Claude Sonnet 4', providerGroupId: 'anthropic', provider: 'Anthropic', lab: 'Anthropic',
    description: 'Fast, thoughtful work across writing, analysis, and code.', contextWindow: '200K context',
    pricing: '$3.00 / $15.00 per 1M tokens', tags: ['Reasoning', 'Vision', 'Agent'], enabled: true,
    agentEnabled: true, favorite: true, tint: '#E8794A', asset: 'claude',
    presets: [{ id: 'reasoning', name: 'Reasoning', icon: 'brain', selectedId: 'medium', choices: [
      { id: 'low', label: 'Low', icon: 'hare' }, { id: 'medium', label: 'Medium', icon: 'brain' }, { id: 'high', label: 'High', icon: 'tortoise' },
    ] }],
  },
  {
    id: 'gpt-5', name: 'GPT-5', providerGroupId: 'openai', provider: 'OpenAI', lab: 'OpenAI', description: 'Strong general intelligence with reliable tool use.',
    contextWindow: '400K context', pricing: '$1.25 / $10.00 per 1M tokens', tags: ['Reasoning', 'Vision', 'Agent'], enabled: true,
    agentEnabled: true, favorite: true, tint: '#D9D9D9', asset: 'openai', presets: [{ id: 'reasoning', name: 'Reasoning', icon: 'brain', selectedId: 'medium', choices: [
      { id: 'minimal', label: 'Minimal', icon: 'bolt' }, { id: 'medium', label: 'Medium', icon: 'brain' }, { id: 'high', label: 'High', icon: 'tortoise' },
    ] }],
  },
  {
    id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', providerGroupId: 'google', provider: 'Google', lab: 'Google', description: 'Long-context multimodal reasoning for documents and media.',
    contextWindow: '1M context', pricing: '$1.25 / $10.00 per 1M tokens', tags: ['Long context', 'Vision'], enabled: true,
    agentEnabled: false, favorite: false, tint: '#6EA8FF', asset: 'gemini', presets: [],
  },
  {
    id: 'deepseek-r1', name: 'DeepSeek R1', providerGroupId: 'deepseek', provider: 'DeepSeek', lab: 'DeepSeek', description: 'Deep reasoning with visible thought traces.',
    contextWindow: '128K context', pricing: '$0.55 / $2.19 per 1M tokens', tags: ['Reasoning'], enabled: true,
    agentEnabled: false, favorite: false, tint: '#5B8CFF', asset: 'deepseek', presets: [],
  },
];

const reasoning = 'Keep durable conversation state in the shared store while the active token stream remains close to the view. Commit the completed response once so persistence stays clean and rendering stays cheap.';

export const seedChats: PrototypeChat[] = [
  {
    id: 'c-streaming', title: 'Streaming state architecture', modelId: 'claude-sonnet-4', createdAt: now - 3 * hour,
    updatedAt: now - 2 * hour, pinned: true, folderId: 'f-work', temporary: false, deletedAt: null, purgeAt: null,
    messages: [
      { id: 'm-stream-user', role: 'user', text: 'How should I structure streaming state in a React chat app?', createdAt: now - 3 * hour },
      { id: 'm-stream-assistant', role: 'assistant', modelId: 'claude-sonnet-4', createdAt: now - 3 * hour + 9000, status: 'complete',
        text: 'Keep the durable conversation in your store, but hold the active token stream close to the view. Commit the finished response once, rather than writing every token through global state.\n\nThis gives you smooth rendering, clean persistence, and a much smaller update surface.',
        activity: [
          { id: 'step-r', kind: 'reasoning', title: 'Reasoned about state boundaries', detail: reasoning, durationMs: 4200, status: 'complete' },
          { id: 'step-t', kind: 'tool', title: 'Inspected current architecture', detail: 'Read the chat store and streaming lifecycle.', output: '12 files searched · 4 relevant matches', durationMs: 1800, status: 'complete' },
        ], meta: '1,204→356 tok · 42 tok/s · 8.4s', feedback: null,
        branches: [
          { id: 'b1', text: 'Keep the durable conversation in your store, but hold the active token stream close to the view. Commit the finished response once, rather than writing every token through global state.\n\nThis gives you smooth rendering, clean persistence, and a much smaller update surface.', modelId: 'claude-sonnet-4', createdAt: now - 3 * hour + 9000 },
          { id: 'b2', text: 'Use two layers: a durable message graph for completed turns and an ephemeral stream buffer for the response in progress. Promote the buffer only when generation completes.', modelId: 'gpt-5', createdAt: now - 2.5 * hour },
        ], activeBranch: 0 },
    ],
  },
  {
    id: 'c-onboarding', title: 'Mobile onboarding flow', modelId: 'gpt-5', createdAt: now - 5 * hour, updatedAt: now - 4 * hour,
    pinned: false, folderId: 'f-design', temporary: false, deletedAt: null, purgeAt: null,
    messages: [
      { id: 'm-onboard-user', role: 'user', text: 'Help me design an onboarding flow for the Pulpo mobile app.', createdAt: now - 5 * hour },
      { id: 'm-onboard-assistant', role: 'assistant', modelId: 'gpt-5', createdAt: now - 5 * hour + 7000, status: 'complete', text: 'Use a focused three-step flow: establish value, explain permissions before iOS asks, then defer account setup until the user has experienced a useful response.', meta: '860→412 tok · 51 tok/s · 8.1s', feedback: 'good' },
    ],
  },
  {
    id: 'c-kv', title: 'KV caching explainer', modelId: 'gemini-2.5-pro', createdAt: now - 18 * day, updatedAt: now - 18 * day,
    pinned: false, folderId: null, temporary: false, deletedAt: null, purgeAt: null,
    messages: [
      { id: 'm-kv-user', role: 'user', text: 'Explain KV caching with a small diagram and a practical tradeoff.', createdAt: now - 18 * day },
      { id: 'm-kv-assistant', role: 'assistant', modelId: 'gemini-2.5-pro', createdAt: now - 18 * day + 5000, status: 'complete', text: 'KV caching stores attention keys and values for tokens already processed. Each decoding step computes only the new token and appends its state.\n\n`prompt → cached K/V → next token`\n\nThe speedup is substantial, but memory grows with context length and batch size.', meta: '512→171 tok · 55 tok/s · 3.1s', feedback: null },
    ],
  },
  {
    id: 'c-deleted', title: 'Old deployment checklist', modelId: 'claude-sonnet-4', createdAt: now - 40 * day, updatedAt: now - 7 * day,
    pinned: false, folderId: null, temporary: false, deletedAt: now - 3 * day, purgeAt: now + 27 * day,
    messages: [{ id: 'm-deleted-user', role: 'user', text: 'Draft a deployment checklist.', createdAt: now - 40 * day }],
  },
];

export function createSeedState(): PersistedPrototypeState {
  return {
    instance: { url: 'https://pulpo.baby', name: 'Pulpo', version: '0.1.0', signupOpen: true, connectedAt: now },
    session: { status: 'signed-in', user: { id: 'u-isaac', name: 'Isaac Thoman', email: 'isaac@pulpo.dev', role: 'member', initials: 'IT' } },
    models: seedModels,
    defaultModelId: 'claude-sonnet-4',
    chats: seedChats,
    folders: [
      { id: 'f-work', name: 'Work', expanded: true },
      { id: 'f-design', name: 'Product design', expanded: true },
      { id: 'f-research', name: 'Research', expanded: false },
    ],
    preferences: {
      theme: 'system', textSize: 'default', sendWithEnter: true,
      streamResponses: true, showReasoning: true, haptics: true,
      localChatLimit: 50, attachmentCacheMb: 50, trashRetention: '30d',
    },
    demo: { response: 'success' },
  };
}
