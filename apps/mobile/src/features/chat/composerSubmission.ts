export interface SubmissionDraft {
  scope: string | null
  body: string
  attachments: readonly { localId: string }[]
}

function sameDraft(current: SubmissionDraft, submitted: SubmissionDraft): boolean {
  return current.scope === submitted.scope && current.body === submitted.body
    && current.attachments.length === submitted.attachments.length
    && current.attachments.every((item, index) => item.localId === submitted.attachments[index]?.localId)
}

/** Own the optimistic clear for one submission, independent of queue/response timing. */
export async function submitComposerDraft<Revision>(options: {
  submitted: SubmissionDraft
  current: () => SubmissionDraft
  prepare: () => Promise<Revision>
  send: () => Promise<boolean>
  clear: () => void
  canRestore: () => boolean
  restore: () => void
  complete: (revision: Revision) => Promise<void>
}): Promise<boolean> {
  let cleared = false
  let accepted = false
  const restore = () => {
    const current = options.current()
    if (cleared && current.scope === options.submitted.scope && !current.body && !current.attachments.length && options.canRestore()) {
      options.restore()
    }
  }
  try {
    const revision = await options.prepare()
    // send inserts optimistic transcript/queue rows synchronously. Clear only
    // the draft it consumed, checking again after the preparation await.
    const pending = options.send()
    if (sameDraft(options.current(), options.submitted)) {
      cleared = true
      options.clear()
    }
    accepted = await pending
    if (!accepted) { restore(); return false }
    await options.complete(revision)
    return true
  } catch (error) {
    if (!accepted) restore()
    throw error
  }
}
