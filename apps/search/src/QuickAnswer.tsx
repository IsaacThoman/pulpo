import { ChevronDown, LoaderCircle, Sparkles, Square } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react'
import { api, SearchApiError } from './api'

const AnswerMarkdown = lazy(() => import('./QuickAnswerMarkdown'))

type AnswerStatus = 'idle' | 'running' | 'complete' | 'stopped' | 'error'

interface ActiveAnswer {
  controller: AbortController
  responseId?: string
}

function cancelAnswer(answer: ActiveAnswer) {
  answer.controller.abort()
  if (answer.responseId) void api.cancelQuickAnswer(answer.responseId).catch(() => {})
}

export function QuickAnswer({ query, modelName, automatic, pulpoOrigin }: {
  query: string
  modelName: string
  automatic: boolean
  pulpoOrigin: string
}) {
  const [status, setStatus] = useState<AnswerStatus>('idle')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<SearchApiError>()
  const [expanded, setExpanded] = useState(false)
  const [runningModel, setRunningModel] = useState(modelName)
  const active = useRef<ActiveAnswer | null>(null)
  const requestId = useRef<string | undefined>(undefined)
  const id = useId()
  const headingId = id + '-title'

  const run = useCallback(async () => {
    if (active.current) return
    const attempt: ActiveAnswer = { controller: new AbortController() }
    active.current = attempt
    const signal = attempt.controller.signal
    requestId.current ??= crypto.randomUUID()
    setStatus('running')
    setAnswer('')
    setError(undefined)
    try {
      const started = await api.quickAnswer(query, requestId.current)
      attempt.responseId = started.responseId
      if (signal.aborted) {
        cancelAnswer(attempt)
        return
      }
      setRunningModel(started.modelName)
      await api.streamQuickAnswer(started.responseId, delta => {
        if (!signal.aborted) setAnswer(previous => (previous + delta).slice(0, 24_000))
      }, signal)
      if (!signal.aborted) setStatus('complete')
    } catch (caught) {
      if (signal.aborted) return
      if (attempt.responseId) {
        cancelAnswer(attempt)
        requestId.current = undefined
      }
      setStatus('error')
      setError(caught instanceof SearchApiError ? caught : new SearchApiError('Pulpo couldn’t complete the answer.', 0))
    } finally {
      if (active.current === attempt) active.current = null
    }
  }, [query])

  useEffect(() => {
    if (!automatic) return
    const start = window.setTimeout(() => {
      setExpanded(true)
      void run()
    }, 0)
    return () => window.clearTimeout(start)
  }, [automatic, run])

  useEffect(() => () => {
    if (active.current) cancelAnswer(active.current)
  }, [])

  function stop() {
    if (active.current) cancelAnswer(active.current)
    active.current = null
    requestId.current = undefined
    setStatus('stopped')
  }

  return (
    <section className="quick-answer" aria-labelledby={headingId} data-expanded={expanded || undefined}>
      <div className="quick-answer-toolbar">
        <h2 id={headingId}>
          <button className="quick-answer-toggle text-button" aria-expanded={expanded} aria-controls={id} onClick={() => {
            setExpanded(!expanded)
            if (status === 'idle') void run()
          }}>
            <span className="quick-answer-icon"><Sparkles size={15} aria-hidden="true" /></span>
            Quick answer <ChevronDown size={14} className="quick-answer-chevron" aria-hidden="true" />
          </button>
        </h2>
        {expanded && <span className="quick-answer-model">{runningModel}</span>}
        {status === 'running' && <button className="text-button quick-answer-stop" onClick={stop}>
          <Square size={12} aria-hidden="true" /> Stop
        </button>}
      </div>
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
            : <button className="secondary-button" onClick={() => void run()}>Try again</button>}
        </div>}
        {status === 'stopped' && <div className="quick-answer-recovery">
          <p role="status">Answer stopped.</p>
          <button className="secondary-button" onClick={() => void run()}>Try again</button>
        </div>}
      </div>
    </section>
  )
}
