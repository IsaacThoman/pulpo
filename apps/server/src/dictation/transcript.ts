import type { AudioTranscript } from '@pulpo/contracts'

export interface DictationTranscript extends AudioTranscript {
  durationSeconds: number
}
