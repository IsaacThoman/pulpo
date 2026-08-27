import type { EpisodicMemoryModelProfile, EpisodicMemoryProfile } from '@pulpo/contracts'

export const EPISODIC_MEMORY_PROFILES: Record<EpisodicMemoryProfile, EpisodicMemoryModelProfile> = {
  embeddinggemma: {
    id: 'embeddinggemma',
    label: 'EmbeddingGemma 300M',
    model: 'embeddinggemma:300m-qat-q4_0',
    dimension: 768,
    approximateSizeBytes: 239_000_000,
  },
  'qwen3-embedding': {
    id: 'qwen3-embedding',
    label: 'Qwen3 Embedding 0.6B',
    model: 'qwen3-embedding:0.6b',
    dimension: 1024,
    approximateSizeBytes: 639_000_000,
  },
}

export const EPISODIC_MEMORY_PROFILE_LIST = Object.values(EPISODIC_MEMORY_PROFILES)
