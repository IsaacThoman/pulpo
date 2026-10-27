import { lazy, Suspense, useContext, useMemo, type ReactNode } from 'react'
import { parseQuiz } from '@pulpo/client-core/quiz'
import { Loader2 } from 'lucide-react'
import { ui } from '@/i18n/ui'
import { MarkdownStreamingContext } from './markdown-streaming'

// Most messages have no quiz, so its interface and Files actions load on first use.
const QuizCard = lazy(() => import('./QuizCard').then((module) => ({ default: module.QuizCard })))

function QuizPlaceholder({ label }: { label: string }) {
  return (
    <div role="status" className="my-4 flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground" data-testid="quiz-pending">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  )
}

/** A ```quiz block in a message: the quiz once it parses, a placeholder while it streams, else the code itself. */
export function QuizBlock({ source, fallback }: { source: string; fallback: ReactNode }) {
  const streaming = useContext(MarkdownStreamingContext)
  const quiz = useMemo(() => parseQuiz(source), [source])
  if (quiz) {
    return (
      <Suspense fallback={<QuizPlaceholder label={ui("Loading quiz…")} />}>
        <QuizCard quiz={quiz} progressKey={source} />
      </Suspense>
    )
  }
  if (!streaming) return <>{fallback}</>
  return <QuizPlaceholder label={ui("Building quiz…")} />
}
