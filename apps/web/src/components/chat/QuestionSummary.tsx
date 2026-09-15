import { questionAnswerText, type QuestionItem } from '@pulpo/contracts'
import { ui } from '@/i18n/ui'

export function QuestionSummary({ item }: { item: QuestionItem }) {
  return <details className="my-3 rounded-xl border p-3 text-sm">
    <summary className="cursor-pointer text-muted-foreground">{item.status === 'pending' ? ui('Waiting for your answer') : item.status === 'cancelled' ? ui('Questions cancelled') : item.status === 'skipped' ? ui('Questions skipped') : ui('Your answers')}</summary>
    <dl className="mt-3 space-y-3">{item.questions.map(q => <div key={q.id}><dt className="font-medium">{q.prompt}</dt><dd className="mt-1 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{item.status === 'pending' ? ui('Awaiting answer') : item.answers[q.id]?.kind === 'skipped' || !item.answers[q.id] ? ui('Skipped') : questionAnswerText(q, item.answers[q.id])}</dd></div>)}</dl>
  </details>
}
