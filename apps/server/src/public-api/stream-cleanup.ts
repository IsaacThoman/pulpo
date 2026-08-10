interface StreamSubscriber {
  disconnect(): void
}

interface StreamReply {
  readonly writableEnded: boolean
  end(): unknown
}

export function createStreamCloser(subscriber: StreamSubscriber, reply: StreamReply): () => void {
  let closed = false
  return () => {
    if (closed) return
    closed = true
    subscriber.disconnect()
    if (!reply.writableEnded) reply.end()
  }
}
