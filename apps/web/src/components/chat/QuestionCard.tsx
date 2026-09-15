import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { answerQuestion, emptyQuestionDraft, navigateQuestion, questionSubmission, restoreQuestionDraft, type QuestionDraft } from '@pulpo/client-core'
import { type AnswerQuestions, type QuestionItem, type ResponseSnapshot } from '@pulpo/contracts'
import { Button } from '@/components/ui/button'
import { apiRequest } from '@/lib/api'
import { useChat } from '@/stores/chat'
import { cn } from '@/lib/utils'
import { ui } from '@/i18n/ui'

export type QuestionCardControl = { setText: (text: string) => void; answerText: (text: string) => void }

export function QuestionCard({ item, namespace, persistDraft = true, controlRef, onTextChange }: {
  item: QuestionItem; namespace: string; persistDraft?: boolean; controlRef?: Ref<QuestionCardControl>; onTextChange: (text: string) => void
}) {
  const storageKey = `pulpo:questions:${namespace}:${item.id}`
  const [draft, setDraft] = useState<QuestionDraft>(() => {
    try { return restoreQuestionDraft(item, persistDraft ? JSON.parse(localStorage.getItem(storageKey) ?? 'null') : null) }
    catch { return emptyQuestionDraft() }
  })
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const question = item.questions[draft.index]!
  const selected = draft.answers[question.id]
  const answers = questionSubmission(item, draft)
  useEffect(() => {
    try { if (persistDraft) localStorage.setItem(storageKey, JSON.stringify(draft)) } catch { /* Private browsing may disallow storage. */ }
    onTextChange(draft.text)
  }, [draft, storageKey, onTextChange, persistDraft])
  useImperativeHandle(controlRef, () => ({
    setText: text => { if (!busyRef.current) setDraft(current => ({ ...current, text })) },
    answerText: text => { if (text.trim() && !busyRef.current) setDraft(current => answerQuestion(item, current, { kind: 'text', text: text.trim() })) },
  }), [item])
  const resolve = async (input: AnswerQuestions) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try {
      const snapshot = await apiRequest<ResponseSnapshot>(`/api/responses/${item.responseId}/questions/${item.id}/answer`, { method: 'POST', body: input })
      useChat.getState().applyResponseSnapshot(snapshot)
      try { localStorage.removeItem(storageKey) } catch { /* Optional local persistence. */ }
    } catch (failure) {
      // Refresh also resolves a conflict when another device answered first.
      try {
        const snapshot = await apiRequest<ResponseSnapshot>(`/api/responses/${item.responseId}`)
        useChat.getState().applyResponseSnapshot(snapshot)
      } catch { /* Keep the draft available offline. */ }
      setError(failure instanceof Error ? failure.message : ui('Unable to submit answers. Try again.'))
    } finally { busyRef.current = false; setBusy(false) }
  }
  return <section aria-label={ui('Agent questions')} className="mb-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
    <div className="mb-4 flex flex-col items-start gap-2 sm:flex-row sm:gap-3">
      <h2 className="min-w-0 flex-1 text-base font-medium [overflow-wrap:anywhere]" aria-live="polite">{question.prompt}</h2>
      <div className="flex shrink-0 items-center gap-1 self-end sm:self-start">
        <Button variant="ghost" size="icon-sm" disabled={busy || draft.index === 0} aria-label={ui('Previous question')} onClick={() => setDraft(navigateQuestion(item, draft, draft.index - 1))}><ChevronLeft className="size-4" /></Button>
        <span className="text-xs tabular-nums text-muted-foreground">{draft.index + 1} / {item.questions.length}</span>
        <Button variant="ghost" size="icon-sm" disabled={busy || draft.index === item.questions.length - 1} aria-label={ui('Next question')} onClick={() => setDraft(navigateQuestion(item, draft, draft.index + 1))}><ChevronRight className="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={ui('Skip all questions')} onClick={() => void resolve({ action: 'skip_all' })}><X className="size-4" /></Button>
      </div>
    </div>
    <div className="max-h-[35dvh] overflow-y-auto" role="group" aria-label={question.prompt}>
      {question.options?.map((option, index) => <button key={index} type="button" disabled={busy}
        aria-pressed={!draft.text && selected?.kind === 'option' && selected.index === index}
        onClick={() => setDraft(answerQuestion(item, draft, { kind: 'option', index }))}
        className={cn('flex w-full items-start gap-3 rounded-xl px-2 py-3 text-left hover:bg-accent focus-visible:outline-ring disabled:opacity-50', !draft.text && selected?.kind === 'option' && selected.index === index && 'bg-accent ring-1 ring-border')}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border text-sm text-muted-foreground">{index + 1}</span>
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]"><span className="font-medium">{option.label}</span>{option.recommended && <span className="ml-2 inline-block rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{ui('Recommended')}</span>}{option.description && <span className="mt-1 block text-sm text-muted-foreground">{option.description}</span>}</span>
      </button>)}
    </div>
    <form className="mt-3 flex items-end gap-2 rounded-xl bg-muted/60 p-2" onSubmit={event => { event.preventDefault(); if (draft.text.trim()) setDraft(answerQuestion(item, draft, { kind: 'text', text: draft.text.trim() })) }}>
      <textarea aria-label={ui('Custom answer')} placeholder={ui('Something else…')} value={draft.text} disabled={busy} rows={1} maxLength={10_000} onChange={event => setDraft({ ...draft, text: event.target.value })} className="max-h-32 min-w-0 flex-1 resize-none bg-transparent p-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring" />
      <Button type="submit" variant="ghost" size="sm" disabled={busy || !draft.text.trim()}>{ui('Use answer')}</Button>
    </form>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span role="status" className="basis-full text-xs text-muted-foreground sm:mr-auto sm:basis-auto">{ui('Waiting for your answer')}</span>
      <div className="ml-auto flex items-center gap-2"><Button variant="ghost" size="sm" disabled={busy} onClick={() => void resolve({ action: 'skip_all' })}>{ui('Skip all')}</Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(answerQuestion(item, draft, { kind: 'skipped' }))}>{ui('Skip')}</Button>
      <Button size="sm" disabled={busy || !answers} onClick={() => answers && void resolve({ action: 'submit', answers })}>{busy ? ui('Submitting…') : ui('Submit')}</Button></div>
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </section>
}
