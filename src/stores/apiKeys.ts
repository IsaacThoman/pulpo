import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ApiKey } from '@/lib/types'

function randomSecret(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let out = ''
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  for (const b of bytes) out += chars[b % chars.length]
  return out
}

const seedKeys: ApiKey[] = [
  {
    id: 'key-1',
    name: 'scripts / dotfiles',
    prefix: 'sk-pulpo-7Kd2',
    createdAt: Date.now() - 92 * 86_400_000,
    lastUsedAt: Date.now() - 2 * 3_600_000,
    scopes: ['chat', 'models'],
    allowedModels: [],
    monthlyBudget: 20,
    totalBudget: 100,
    spentThisMonth: 6.42,
    spentTotal: 41.18,
    revoked: false,
  },
  {
    id: 'key-2',
    name: 'home-assistant TTS',
    prefix: 'sk-pulpo-Qx91',
    createdAt: Date.now() - 40 * 86_400_000,
    lastUsedAt: Date.now() - 26 * 3_600_000,
    scopes: ['chat', 'images'],
    allowedModels: ['gpt-4o-mini', 'llama-3.3-70b'],
    monthlyBudget: 5,
    totalBudget: null,
    spentThisMonth: 1.08,
    spentTotal: 3.74,
    revoked: false,
  },
  {
    id: 'key-3',
    name: 'old ci job',
    prefix: 'sk-pulpo-Zz00',
    createdAt: Date.now() - 200 * 86_400_000,
    lastUsedAt: Date.now() - 61 * 86_400_000,
    scopes: ['chat'],
    allowedModels: [],
    monthlyBudget: null,
    totalBudget: 25,
    spentThisMonth: 0,
    spentTotal: 25,
    revoked: true,
  },
]

interface ApiKeysState {
  keys: ApiKey[]
  createKey: (
    input: Pick<ApiKey, 'name' | 'scopes' | 'allowedModels' | 'monthlyBudget' | 'totalBudget'>
  ) => { key: ApiKey; secret: string }
  revokeKey: (id: string) => void
  deleteKey: (id: string) => void
}

export const useApiKeys = create<ApiKeysState>()(
  persist(
    (set, get) => ({
      keys: seedKeys,
      createKey: (input) => {
        const secret = `sk-pulpo-${randomSecret()}`
        const key: ApiKey = {
          id: crypto.randomUUID(),
          name: input.name,
          prefix: secret.slice(0, 12),
          createdAt: Date.now(),
          lastUsedAt: null,
          scopes: input.scopes,
          allowedModels: input.allowedModels,
          monthlyBudget: input.monthlyBudget,
          totalBudget: input.totalBudget,
          spentThisMonth: 0,
          spentTotal: 0,
          revoked: false,
        }
        set({ keys: [key, ...get().keys] })
        return { key, secret }
      },
      revokeKey: (id) =>
        set((s) => ({ keys: s.keys.map((k) => (k.id === id ? { ...k, revoked: true } : k)) })),
      deleteKey: (id) => set((s) => ({ keys: s.keys.filter((k) => k.id !== id) })),
    }),
    { name: 'pulpo-api-keys' }
  )
)
