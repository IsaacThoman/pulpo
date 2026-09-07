type SelectionStage = 'tap' | 'activate' | 'contentReady' | 'slideStart' | 'slideEnd' | 'motionStart' | 'motionEnd'
type SelectionSample = { chatId: string; stage: SelectionStage; at: number; resident?: boolean }
let observer: ((sample: SelectionSample) => void) | undefined

/** Opt-in instrumentation for the synthetic native harness; no work when disabled. */
export function observeChatSelection(next: (sample: SelectionSample) => void): () => void {
  observer = next
  return () => { if (observer === next) observer = undefined }
}
export function hasChatSelectionObserver(): boolean { return observer !== undefined }
export function recordChatSelection(chatId: string, stage: SelectionStage, resident?: boolean, at?: number): void {
  if (observer) observer({ chatId, stage, at: at ?? Date.now(), resident })
}

export type TranscriptPositionSample = { chatId: string; at: number; bottom?: number; kind: 'measure' | 'readerStart' | 'readerEnd' }
let positionObserver: ((sample: TranscriptPositionSample) => void) | undefined
export function observeTranscriptPosition(next: (sample: TranscriptPositionSample) => void): () => void {
  positionObserver = next
  return () => { if (positionObserver === next) positionObserver = undefined }
}
export function hasTranscriptPositionObserver(): boolean { return positionObserver !== undefined }
export function recordTranscriptPosition(sample: TranscriptPositionSample): void { positionObserver?.(sample) }
