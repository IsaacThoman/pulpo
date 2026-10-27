import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { quizFileName, quizFlashcards, quizResultsMessage, quizScore, type Quiz } from '@pulpo/client-core/quiz'
import { Check, ChevronLeft, ChevronRight, Download, FolderDown, FolderInput, MessageSquareText, RotateCcw, X } from 'lucide-react'
import { Markdown } from '@/components/chat/Markdown'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { INITIAL_QUIZ_PROGRESS, useQuizStore, type QuizProgress } from '@/stores/quiz'
import { canInsertIntoComposer, insertIntoComposer, subscribeComposerInsert } from './composer-focus'
import { downloadQuiz, saveQuizToFiles } from './quiz-actions'
import { SaveToFilesDialog } from './SaveToFiles'
import { useCanSaveToFiles, useSavedToFilesToast } from './use-save-to-files'

/** Past this many questions the footer counts them instead of showing a dot for each. */
const MAX_QUESTION_DOTS = 12

function useQuizProgress(key: string) {
  const progress = useQuizStore((state) => state.progress[key]) ?? INITIAL_QUIZ_PROGRESS
  const update = useQuizStore((state) => state.update)
  return [progress, (change: Partial<QuizProgress> | ((current: QuizProgress) => Partial<QuizProgress>)) => update(key, change)] as const
}

function QuizText({ text, className }: { text: string; className?: string }) {
  return <div className={cn('min-w-0 [&_li]:leading-6 [&_p]:leading-6', className)}><Markdown content={text} /></div>
}

function SaveQuizMenu({ quiz }: { quiz: Quiz }) {
  const [picking, setPicking] = useState(false)
  const canSave = useCanSaveToFiles()
  const saved = useSavedToFilesToast()
  const name = quizFileName(quiz)
  const buttonClass = 'flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
  if (!canSave) {
    return (
      <button type="button" aria-label={ui("Download quiz")} title={ui("Download quiz")} className={buttonClass} onClick={() => downloadQuiz(quiz, name)}>
        <Download className="size-4" aria-hidden="true" />
      </button>
    )
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={ui("Save quiz")} title={ui("Save quiz")} className={buttonClass}>
            <FolderDown className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => downloadQuiz(quiz, name)}><Download /> {ui("Download")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPicking(true)}><FolderInput /> {ui("Save to Files…")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SaveToFilesDialog name={name} save={(input) => saveQuizToFiles(quiz, input)} open={picking} onOpenChange={setPicking} onSaved={saved} />
    </>
  )
}

function OptionButton({ text, state, disabled, onSelect }: {
  text: string
  state: 'idle' | 'correct' | 'wrong' | 'dimmed'
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={state === 'correct' || state === 'wrong'}
      disabled={disabled}
      onClick={onSelect}
      data-state={state}
      className={cn(
        'flex w-full min-w-0 items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors',
        state === 'idle' && 'cursor-pointer bg-background hover:bg-accent',
        state === 'correct' && 'border-emerald-500/50 bg-emerald-500/10',
        state === 'wrong' && 'border-destructive/50 bg-destructive/10',
        state === 'dimmed' && 'opacity-60',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/40',
          state === 'correct' && 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500',
          state === 'wrong' && 'border-destructive bg-destructive text-white',
        )}
      >
        {state === 'correct' && <Check className="size-3" strokeWidth={3} />}
        {state === 'wrong' && <X className="size-3" strokeWidth={3} />}
      </span>
      <QuizText text={text} className="flex-1" />
    </button>
  )
}

function QuestionDots({ quiz, progress, onSelect }: { quiz: Quiz; progress: QuizProgress; onSelect: (index: number) => void }) {
  const total = quiz.questions.length
  if (total > MAX_QUESTION_DOTS) {
    return <span className="text-sm text-muted-foreground tabular-nums">{uit`${progress.question + 1} of ${total}`}</span>
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {quiz.questions.map((question, index) => {
        const chosen = progress.answers[index]
        const current = !progress.finished && index === progress.question
        return (
          <button
            key={index}
            type="button"
            aria-label={uit`Question ${index + 1}`}
            aria-current={current ? 'step' : undefined}
            onClick={() => onSelect(index)}
            className={cn(
              'flex size-8 cursor-pointer items-center justify-center rounded-full text-sm tabular-nums transition-colors',
              chosen === undefined && 'bg-muted text-muted-foreground hover:text-foreground',
              chosen !== undefined && chosen === question.answer && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
              chosen !== undefined && chosen !== question.answer && 'bg-destructive/15 text-destructive',
              current && 'ring-2 ring-primary/60',
            )}
          >
            {index + 1}
          </button>
        )
      })}
    </div>
  )
}

function QuizResults({ quiz, progress, onReview, onRetake }: { quiz: Quiz; progress: QuizProgress; onReview: () => void; onRetake: () => void }) {
  const { correct, total } = quizScore(quiz, progress.answers)
  const canSend = useSyncExternalStore(subscribeComposerInsert, canInsertIntoComposer, () => false)
  const missed = total - correct
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center" data-testid="quiz-results">
      <p className="text-4xl font-semibold tabular-nums">{uit`${correct} / ${total}`}</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {missed === 0
          ? ui("You got every question right.")
          : missed === 1
            ? ui("You missed one question. Send your results to go over it.")
            : uit`You missed ${missed} questions. Send your results to go over them.`}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {canSend && (
          <Button type="button" size="sm" onClick={() => insertIntoComposer(quizResultsMessage(quiz, progress.answers))}>
            <MessageSquareText /> {ui("Send results")}
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" onClick={onReview}>{ui("Review answers")}</Button>
        <Button type="button" size="sm" variant="outline" onClick={onRetake}><RotateCcw /> {ui("Retake")}</Button>
      </div>
    </div>
  )
}

function QuizQuestions({ quiz, progress, update }: {
  quiz: Quiz
  progress: QuizProgress
  update: ReturnType<typeof useQuizProgress>[1]
}) {
  const [hintOpen, setHintOpen] = useState(false)
  if (progress.finished) {
    return (
      <QuizResults
        quiz={quiz}
        progress={progress}
        onReview={() => update({ finished: false, question: 0 })}
        onRetake={() => update({ finished: false, question: 0, answers: {} })}
      />
    )
  }
  const index = Math.min(progress.question, quiz.questions.length - 1)
  const question = quiz.questions[index]!
  const chosen = progress.answers[index]
  const answered = chosen !== undefined
  const last = index === quiz.questions.length - 1
  const go = (next: number) => { setHintOpen(false); update({ question: next }) }
  return (
    <div className="flex flex-col gap-4">
      <QuizText text={question.prompt} className="text-lg font-medium leading-snug [&_p]:leading-snug" />
      <div role="radiogroup" aria-label={uit`Question ${index + 1}`} className="flex flex-col gap-2">
        {question.options.map((option, optionIndex) => (
          <OptionButton
            key={optionIndex}
            text={option}
            disabled={answered}
            state={!answered ? 'idle' : optionIndex === question.answer ? 'correct' : optionIndex === chosen ? 'wrong' : 'dimmed'}
            onSelect={() => update((current) => ({ answers: { ...current.answers, [index]: optionIndex } }))}
          />
        ))}
      </div>
      {answered && (
        <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm" role="status">
          <p className={cn('font-medium', chosen === question.answer ? 'text-emerald-700 dark:text-emerald-300' : 'text-destructive')}>
            {chosen === question.answer ? ui("Correct") : ui("Not quite")}
          </p>
          {question.explanation && <QuizText text={question.explanation} className="mt-1 text-muted-foreground" />}
        </div>
      )}
      {question.hint && !answered && (
        <Collapsible open={hintOpen} onOpenChange={setHintOpen}>
          <CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ChevronRight className={cn('size-4 transition-transform', hintOpen && 'rotate-90')} />
            {hintOpen ? ui("Hide hint") : ui("Show hint")}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <QuizText text={question.hint} className="mt-2 pl-5.5 text-sm text-muted-foreground" />
          </CollapsibleContent>
        </Collapsible>
      )}
      <div className="mt-2 flex items-center justify-between gap-3">
        <QuestionDots quiz={quiz} progress={progress} onSelect={go} />
        <Button
          type="button"
          size="sm"
          variant={answered ? 'default' : 'secondary'}
          onClick={() => last ? update({ finished: true }) : go(index + 1)}
        >
          {last ? ui("See results") : answered ? ui("Next") : ui("Skip")}
        </Button>
      </div>
    </div>
  )
}

/** One side of a flashcard. Both sides share a grid cell, so the card is as tall as the longer one. */
function FlashcardFace({ side, hidden, back = false, children }: { side: string; hidden: boolean; back?: boolean; children: ReactNode }) {
  return (
    <div
      aria-hidden={hidden}
      data-testid={back ? 'quiz-flashcard-back' : 'quiz-flashcard-front'}
      className={cn(
        'col-start-1 row-start-1 flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border bg-muted/30 px-6 py-8 backface-hidden transition-colors group-hover/flashcard:bg-muted/50 group-focus-visible/flashcard:ring-[3px] group-focus-visible/flashcard:ring-ring/50',
        back && 'rotate-y-180',
      )}
    >
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{side}</span>
      {children}
    </div>
  )
}

function QuizFlashcards({ quiz, progress, update }: {
  quiz: Quiz
  progress: QuizProgress
  update: ReturnType<typeof useQuizProgress>[1]
}) {
  const cards = useMemo(() => quizFlashcards(quiz), [quiz])
  const index = Math.min(progress.card, cards.length - 1)
  const card = cards[index]!
  const go = (next: number) => update({ card: next, flipped: false })
  return (
    <div className="flex flex-col gap-3">
      {/* Keyed by card so a new card starts on its front instead of flipping back with its answer showing. */}
      <button
        key={index}
        type="button"
        onClick={() => update((current) => ({ flipped: !current.flipped }))}
        aria-label={progress.flipped ? ui("Show front") : ui("Show back")}
        data-testid="quiz-flashcard"
        className="group/flashcard w-full cursor-pointer rounded-xl text-center perspective-[1200px] focus-visible:outline-none"
      >
        <div className={cn(
          'grid transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] transform-3d motion-reduce:transition-none',
          progress.flipped && 'rotate-y-180',
        )}>
          <FlashcardFace side={ui("Front side")} hidden={progress.flipped}>
            <QuizText text={card.front} className="max-w-full text-lg font-medium" />
          </FlashcardFace>
          <FlashcardFace side={ui("Back side")} hidden={!progress.flipped} back>
            <QuizText text={card.back} className="max-w-full" />
          </FlashcardFace>
        </div>
      </button>
      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="ghost" size="icon-sm" className="rounded-full" aria-label={ui("Previous card")} disabled={index === 0} onClick={() => go(index - 1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-sm text-muted-foreground tabular-nums">{uit`${index + 1} / ${cards.length}`}</span>
        <Button type="button" variant="ghost" size="icon-sm" className="rounded-full" aria-label={ui("Next card")} disabled={index === cards.length - 1} onClick={() => go(index + 1)}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function ModeSwitch({ mode, onChange }: { mode: QuizProgress['mode']; onChange: (mode: QuizProgress['mode']) => void }) {
  const option = (value: QuizProgress['mode'], label: string) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => onChange(value)}
      className={cn(
        'cursor-pointer rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
        mode === value && 'bg-background text-foreground shadow-sm dark:bg-input/40',
      )}
    >
      {label}
    </button>
  )
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {option('quiz', ui("Quiz"))}
      {option('cards', ui("Flashcards"))}
    </div>
  )
}

/**
 * An interactive quiz with flashcards. `progressKey` identifies the quiz so answers survive the card
 * unmounting; `saveable` offers downloading it or saving it to Files as a `.quiz` file.
 */
export function QuizCard({ quiz, progressKey, saveable = true, className }: {
  quiz: Quiz
  progressKey: string
  saveable?: boolean
  className?: string
}) {
  const [progress, update] = useQuizProgress(progressKey)
  const hasQuestions = quiz.questions.length > 0
  const mode = hasQuestions ? progress.mode : 'cards'
  return (
    <section className={cn('my-4 min-w-0 rounded-xl border bg-card p-4 text-card-foreground sm:p-5', className)} aria-label={quiz.title ?? ui("Quiz")} data-testid="quiz-card">
      <header className="mb-4 flex min-w-0 items-center gap-3">
        {hasQuestions && <ModeSwitch mode={mode} onChange={(next) => update({ mode: next })} />}
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">{quiz.title}</h3>
        {saveable && <SaveQuizMenu quiz={quiz} />}
      </header>
      {mode === 'quiz'
        ? <QuizQuestions quiz={quiz} progress={progress} update={update} />
        : <QuizFlashcards quiz={quiz} progress={progress} update={update} />}
    </section>
  )
}
