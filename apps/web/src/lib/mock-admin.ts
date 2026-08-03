import { MODELS } from './mock'

export interface AdminProvider {
  id: string
  name: string
  baseUrl: string
  hasApiKey: boolean
  modelCount: number
}

export const ADMIN_PROVIDERS: AdminProvider[] = [
  { id: 'prov-1', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', hasApiKey: true, modelCount: 3 },
  { id: 'prov-2', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', hasApiKey: true, modelCount: 4 },
  { id: 'prov-3', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', hasApiKey: true, modelCount: 2 },
  { id: 'prov-4', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', hasApiKey: false, modelCount: 0 },
  { id: 'prov-5', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', hasApiKey: true, modelCount: 1 },
]

export interface AdminLab {
  id: string
  name: string
  logo: string
  modelCount: number
}

/** Labs currently used by models in the catalog. */
export const ADMIN_LABS: AdminLab[] = (() => {
  const byName = new Map<string, AdminLab>()
  for (const m of MODELS) {
    const existing = byName.get(m.provider)
    if (existing) {
      existing.modelCount += 1
    } else {
      byName.set(m.provider, {
        id: m.labLogo,
        name: m.provider,
        logo: m.labLogo,
        modelCount: 1,
      })
    }
  }
  return [...byName.values()]
})()

export interface Banner {
  id: string
  type: 'info' | 'warning' | 'error' | 'success'
  content: string
  dismissible: boolean
}

export const SEED_BANNERS: Banner[] = [
  { id: 'bn-1', type: 'info', content: 'pulpo will be down for maintenance Sunday 03:00–03:30 UTC.', dismissible: true },
]
