import { ChevronDown, LoaderCircle, Sparkles, Square } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react'
import { api, SearchApiError, type QuickAnswerSession } from './api'

const AnswerMarkdown = lazy(() => import('./QuickAnswerMarkdown'))

type AnswerStatus = 'idle' | 'running' | 'stopping' | 'complete' | 'stopped' | 'error'

interface ActiveAnswer {
  controller: AbortController
  started: Promise<QuickAnswerSession>
}

export function QuickAnswer({ query, modelName, automatic, onAutomaticStart, pulpoOrigin }: {
  query: string
  modelName: string
  automatic: boolean
  onAutomaticStart: () => void
  pulpoOrigin: string
}) {
  const [status, setStatus] = useState<AnswerStatus>('idle')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<SearchApiError>()
  const [expanded, setExpanded] = useState(false)
  const [runningModel, setRunningModel] = useState(modelName)
  const active = useRef<ActiveAnswer | null>(null)
  const stopping = useRef(false)
  const requestId = useRef<string | undefined>(undefined)
  const session = useRef<QuickAnswerSession | undefined>(undefined)
  const unconfirmed = useRef(false)
  const toggleButton = useRef<HTMLButtonElement>(null)
  const stopButton = useRef<HTMLButtonElement>(null)
  const id = useId()
  const headingId = id + '-title'

  const run = useCallback(async () => {
    if (active.current || stopping.current) return
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
    try {
      const started = await attempt.started
      session.current = started
      if (signal.aborted) return
      setRunningModel(started.modelName)
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
      void pending.started.then(({ responseId }) => api.cancelQuickAnswer(responseId)).catch(() => {})
    } else if (unconfirmed.current && session.current) {
      void api.cancelQuickAnswer(session.current.responseId).catch(() => {})
    }
  }, [])

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
      <div className="quick-answer-toolbar">
        <h2 id={headingId}>
          <button ref={toggleButton} className="quick-answer-toggle text-button" aria-expanded={expanded} aria-controls={id} onClick={() => {
            setExpanded(!expanded)
            if (status === 'idle') void run()
          }}>
            <span className="quick-answer-icon"><Sparkles size={15} aria-hidden="true" /></span>
            Quick answer <ChevronDown size={14} className="quick-answer-chevron" aria-hidden="true" />
          </button>
        </h2>
        {expanded && <span className="quick-answer-model">{runningModel}</span>}
        {(status === 'running' || status === 'stopping') && <button ref={stopButton} className="text-button quick-answer-stop"
          disabled={status === 'stopping'} onClick={() => void stop()}>
          <Square size={12} aria-hidden="true" /> {status === 'stopping' ? 'Stopping…' : 'Stop'}
        </button>}
      </div>
      <span className="sr-only" role="status">{status === 'complete' ? 'Quick answer ready.' : ''}</span>
      <div id={id} className="quick-answer-content" hidden={!expanded}>
        {status === 'running' && !answer && <p className="quick-answer-progress" role="status">
          <LoaderCircle size={15} aria-hidden="true" /> Pulpo is working…
        </p>}
        {answer && <Suspense fallback={<p className="quick-answer-plain">{answer}</p>}>
          <AnswerMarkdown text={answer} />
        </Suspense>}
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
      </div>
    </section>
  )
}
