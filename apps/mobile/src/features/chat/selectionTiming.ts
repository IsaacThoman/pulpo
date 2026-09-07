type SelectionStage = 'tap' | 'activate' | 'contentReady' | 'slideStart' | 'slideEnd'
type SelectionSample = { chatId: string; stage: SelectionStage; at: number; resident?: boolean }
let observer: ((sample: SelectionSample) => void) | undefined

/** Opt-in instrumentation for the synthetic native harness; no work when disabled. */
export function observeChatSelection(next: (sample: SelectionSample) => void): () => void {
  observer = next
  return () => { if (observer === next) observer = undefined }
}
export function recordChatSelection(chatId: string, stage: SelectionStage, resident?: boolean): void {
  if (observer) observer({ chatId, stage, at: performance.now(), resident })
}
