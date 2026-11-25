import { ChevronDown } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react'
import { api, SearchApiError, type QuickAnswerSession } from './api'

const loadAnswerMarkdown = () => import('./QuickAnswerMarkdown')
const AnswerMarkdown = lazy(loadAnswerMarkdown)

type AnswerStatus = 'idle' | 'running' | 'stopping' | 'complete' | 'stopped' | 'error'

interface ActiveAnswer {
  controller: AbortController
  started: Promise<QuickAnswerSession>
}

export function QuickAnswer({ query, automatic, onAutomaticStart, pulpoOrigin }: {
  query: string
  automatic: boolean
  onAutomaticStart: () => void
  pulpoOrigin: string
}) {
  const [status, setStatus] = useState<AnswerStatus>('idle')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<SearchApiError>()
  const [expanded, setExpanded] = useState(false)
  const [chatId, setChatId] = useState<string>()
  const [showFull, setShowFull] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const active = useRef<ActiveAnswer | null>(null)
  const stopping = useRef(false)
  const requestId = useRef<string | undefined>(undefined)
  const session = useRef<QuickAnswerSession | undefined>(undefined)
  const handedOff = useRef<string | undefined>(undefined)
  const unconfirmed = useRef(false)
  const toggleButton = useRef<HTMLButtonElement>(null)
  const stopButton = useRef<HTMLButtonElement>(null)
  const preview = useRef<HTMLDivElement>(null)
  const previewBody = useRef<HTMLDivElement>(null)
  const id = useId()
  const headingId = id + '-title'
  const previewId = id + '-preview'
  const clipped = overflows && !showFull

  const run = useCallback(async () => {
    if (active.current || stopping.current) return
    void loadAnswerMarkdown().catch(() => {})
    requestId.current ??= crypto.randomUUID()
    const attempt: ActiveAnswer = {
      controller: new AbortController(),
      started: session.current ? Promise.resolve(session.current) : api.quickAnswer(query, requestId.current),
    }
    active.current = attempt
    const signal = attempt.controller.signal
    unconfirmed.current = true
    setStatus('running')
    setAnswer('')
    setError(undefined)
    setChatId(session.current?.chatId)
    setShowFull(false)
    try {
      const started = await attempt.started
      session.current = started
      if (signal.aborted) return
      setChatId(started.chatId)
      await api.streamQuickAnswer(started.responseId, delta => {
        if (!signal.aborted) setAnswer(previous => (previous + delta).slice(0, 24_000))
      }, signal)
      if (!signal.aborted) {
        unconfirmed.current = false
        setStatus('complete')
      }
    } catch (caught) {
      if (signal.aborted) return
      if (caught instanceof SearchApiError && caught.code === 'quick_answer_terminal') {
        unconfirmed.current = false
        session.current = undefined
        requestId.current = undefined
      }
      setStatus('error')
      setError(caught instanceof SearchApiError ? caught : new SearchApiError('Pulpo couldn’t complete the answer.', 0))
    } finally {
      if (active.current === attempt) active.current = null
      if (!signal.aborted && document.activeElement === stopButton.current) toggleButton.current?.focus()
    }
  }, [query])

  useEffect(() => {
    if (!automatic) return
    const start = window.setTimeout(() => {
      setExpanded(true)
      onAutomaticStart()
      void run()
    }, 0)
    return () => window.clearTimeout(start)
  }, [automatic, onAutomaticStart, run])

  useEffect(() => () => {
    const pending = active.current
    if (pending) {
      pending.controller.abort()
      void pending.started.then(({ responseId }) => {
        if (handedOff.current !== responseId) return api.cancelQuickAnswer(responseId)
      }).catch(() => {})
    } else if (unconfirmed.current && session.current && handedOff.current !== session.current.responseId) {
      void api.cancelQuickAnswer(session.current.responseId).catch(() => {})
    }
  }, [])

  useEffect(() => {
    const body = previewBody.current
    if (!expanded || !body || typeof ResizeObserver === 'undefined') return
    const update = () => {
      const lineHeight = Number.parseFloat(window.getComputedStyle(body).lineHeight)
      setOverflows(body.offsetHeight > 5 * lineHeight + 1)
    }
    const observer = new ResizeObserver(update)
    observer.observe(body)
    update()
    return () => observer.disconnect()
  }, [expanded])

  async function stop() {
    const pending = active.current
    if (!pending) return
    if (document.activeElement === stopButton.current) toggleButton.current?.focus()
    pending.controller.abort()
    active.current = null
    stopping.current = true
    setStatus('stopping')
    try {
      const started = await pending.started
      await api.cancelQuickAnswer(started.responseId)
      unconfirmed.current = false
      session.current = undefined
      requestId.current = undefined
      setStatus('stopped')
    } catch {
      setError(new SearchApiError('Pulpo couldn’t confirm the stop. Reconnect to check the answer.', 0))
      setStatus('error')
    } finally {
      stopping.current = false
    }
  }

  return (
    <section className="quick-answer" aria-labelledby={headingId} data-expanded={expanded || undefined}>
      <div className="quick-answer-heading">
        <h2 id={headingId}>
          <button ref={toggleButton} className="quick-answer-toggle text-button" aria-expanded={expanded} aria-controls={id} onClick={() => {
            setExpanded(!expanded)
            if (status === 'idle') void run()
          }}>
            Quick answer
          </button>
        </h2>
        {(status === 'running' || status === 'stopping') && <button ref={stopButton} className="text-button quick-answer-stop"
          disabled={status === 'stopping'} onClick={() => void stop()}>
          {status === 'stopping' ? 'Stopping…' : 'Stop'}
        </button>}
      </div>
      <span className="sr-only" role="status">{status === 'complete' ? 'Quick answer ready.' : ''}</span>
      <div id={id} className="quick-answer-content" hidden={!expanded}>
        {status === 'running' && !answer && <p className="quick-answer-progress" role="status">Working…</p>}
        <div className="quick-answer-preview" id={previewId} ref={preview} data-clipped={clipped || undefined}
          onFocus={event => {
            if (clipped && preview.current && event.target.getBoundingClientRect().bottom > preview.current.getBoundingClientRect().bottom) {
              setShowFull(true)
            }
          }}>
          <div className="quick-answer-preview-body" ref={previewBody}>
            {answer && <Suspense fallback={<p className="quick-answer-progress" role="status">Formatting answer…</p>}>
              <AnswerMarkdown text={answer} />
            </Suspense>}
          </div>
        </div>
        {overflows && answer && <div className="quick-answer-divider">
          <button className="text-button" type="button" aria-expanded={showFull} aria-controls={previewId} onClick={() => setShowFull(!showFull)}>
            {showFull ? 'Show less' : 'Show more'} <ChevronDown size={14} aria-hidden="true" />
          </button>
        </div>}
        {status === 'error' && <div className="quick-answer-recovery" role="alert">
          <p>{error?.message}</p>
          {error?.status === 402
            ? <a className="secondary-button" href={pulpoOrigin}>Open Pulpo</a>
            : <button className="secondary-button" onClick={() => void run()}>{session.current ? 'Reconnect' : 'Try again'}</button>}
        </div>}
        {status === 'stopped' && <div className="quick-answer-recovery">
          <p role="status">Answer stopped.</p>
          <button className="secondary-button" onClick={() => void run()}>Try again</button>
        </div>}
        {chatId && <a className="text-button quick-answer-open" href={new URL('/c/' + encodeURIComponent(chatId), pulpoOrigin).href}
          target="_blank" rel="noopener noreferrer" onClick={() => { handedOff.current = session.current?.responseId }}>
          Open in Pulpo
        </a>}
      </div>
    </section>
  )
}
