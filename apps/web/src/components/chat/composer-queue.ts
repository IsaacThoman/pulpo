export function composerPrimaryAction(active: boolean, hasDraft: boolean): 'stop' | 'send' {
  return active && !hasDraft ? 'stop' : 'send'
}

export function shouldQueueComposerMessage(active: boolean, queueLength: number): boolean {
  return active || queueLength > 0
}
