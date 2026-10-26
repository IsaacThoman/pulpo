import { quizFlashcards, quizResultsMessage, quizScore, type Quiz, type QuizCard as Flashcard, type QuizQuestion } from '@pulpo/client-core/quiz'
import { useQueryClient } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeMarkdown } from '../../components/SafeMarkdown'
import { PrimaryButton, Segmented } from '../../mockup5/src/components/PrototypeUI'
import { SymbolView } from '../../platform/SymbolView'
import { useAppTheme } from '../../theme'
import { useFilesEnabled } from '../files/availability'
import { filesErrorMessage } from '../files/display'
import { useFilesNamespace } from '../files/useFilesNamespace'
import { QuizComposerContext } from './composer'
import { saveQuizToFiles, shareQuiz } from './export'
import { EMPTY_QUIZ_PROGRESS, useQuizProgress, type QuizProgress } from './progress'

type Mode = NonNullable<QuizProgress['mode']>
const MODES = [{ value: 'quiz', label: 'Quiz' }, { value: 'flashcards', label: 'Flashcards' }] as const

/**
 * An interactive quiz: its questions one at a time, answered by tapping an option, then the score;
 * and its flashcards. `progressKey` (the quiz's source) keeps the user's place across remounts.
 */
export function QuizCard({ quiz, progressKey, exportable = true }: { quiz: Quiz; progressKey: string; exportable?: boolean }) {
  const theme = useAppTheme()
  const progress = useQuizProgress((state) => state.progress[progressKey]) ?? EMPTY_QUIZ_PROGRESS
  const update = useQuizProgress((state) => state.update)
  const cards = useMemo(() => quizFlashcards(quiz), [quiz])
  const hasQuestions = quiz.questions.length > 0
  const mode: Mode = hasQuestions ? progress.mode ?? 'quiz' : 'flashcards'
  return (
    <View style={[styles.card, { borderColor: theme.separator, backgroundColor: theme.fill }]} testID="quiz-card">
      <View style={styles.header}>
        <SymbolView name="checklist" size={16} tintColor={theme.secondary} />
        <Text accessibilityRole="header" numberOfLines={2} style={[styles.title, { color: theme.text }]}>{quiz.title ?? (hasQuestions ? 'Quiz' : 'Flashcards')}</Text>
        {exportable ? <QuizExportActions quiz={quiz} /> : null}
      </View>
      {hasQuestions && cards.length ? (
        <View style={styles.modes}>
          <Segmented options={MODES} value={mode} onChange={(next) => update(progressKey, { mode: next })} />
        </View>
      ) : null}
      {mode === 'quiz'
        ? progress.finished
          ? <QuizResults quiz={quiz} progress={progress} progressKey={progressKey} />
          : <QuizQuestionView quiz={quiz} progress={progress} progressKey={progressKey} />
        : <Flashcards cards={cards} index={progress.card} onChange={(card) => update(progressKey, { card })} />}
    </View>
  )
}

/** Shown in place of a quiz while the model is still writing it. */
export function QuizBuildingCard() {
  const theme = useAppTheme()
  return (
    <View accessibilityLabel="Building quiz" style={[styles.card, styles.building, { borderColor: theme.separator, backgroundColor: theme.fill }]}>
      <ActivityIndicator size="small" color={theme.secondary} />
      <Text style={[styles.buildingLabel, { color: theme.secondary }]}>Building quiz…</Text>
    </View>
  )
}

function QuizQuestionView({ quiz, progress, progressKey }: { quiz: Quiz; progress: QuizProgress; progressKey: string }) {
  const theme = useAppTheme()
  const update = useQuizProgress((state) => state.update)
  const answer = useQuizProgress((state) => state.answer)
  const index = Math.min(progress.question, quiz.questions.length - 1)
  const question = quiz.questions[index]!
  const chosen = progress.answers[index]
  const answered = chosen !== undefined
  const last = index === quiz.questions.length - 1
  const choose = (option: number) => {
    if (answered) return
    answer(progressKey, index, option)
    Haptics.notificationAsync(option === question.answer ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error)
  }
  return (
    <View style={styles.body}>
      <Text style={[styles.counter, { color: theme.secondary }]}>{`Question ${index + 1} of ${quiz.questions.length}`}</Text>
      <SafeMarkdown large selectable={Platform.OS !== 'android'}>{question.prompt}</SafeMarkdown>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {question.options.map((option, optionIndex) => (
          <OptionRow key={optionIndex} answered={answered} chosen={chosen === optionIndex} correct={question.answer === optionIndex} onPress={() => choose(optionIndex)} text={option} />
        ))}
      </View>
      {answered ? <Feedback question={question} chosen={chosen} /> : question.hint ? <Hint key={index} text={question.hint} /> : null}
      <View style={styles.footer}>
        <QuestionDots quiz={quiz} answers={progress.answers} current={index} onSelect={(question) => update(progressKey, { question })} />
        <Pressable
          accessibilityRole="button"
          onPress={() => update(progressKey, last ? { finished: true } : { question: index + 1 })}
          style={({ pressed }) => [styles.pill, { backgroundColor: answered ? theme.accent : theme.fillStrong }, pressed && styles.pressed]}
        >
          <Text style={[styles.pillLabel, { color: answered ? theme.accentText : theme.text }]}>{last ? 'See results' : 'Next'}</Text>
        </Pressable>
      </View>
    </View>
  )
}

function OptionRow({ text, answered, chosen, correct, onPress }: { text: string; answered: boolean; chosen: boolean; correct: boolean; onPress: () => void }) {
  const theme = useAppTheme()
  // Once answered, the right option is marked, and the chosen one too when it was wrong.
  const tone = !answered ? null : correct ? theme.green : chosen ? theme.red : null
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: chosen, disabled: answered }}
      accessibilityLabel={[text, answered && correct ? 'correct answer' : null, chosen && !correct ? 'incorrect' : null].filter(Boolean).join(', ')}
      disabled={answered}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        { borderColor: tone ?? theme.separator, backgroundColor: tone ? `${tone}1A` : theme.elevated },
        answered && !tone && styles.dimmed,
        pressed && styles.pressed,
      ]}
    >
      {tone ? (
        <SymbolView name={correct ? 'checkmark.circle.fill' : 'xmark.circle.fill'} size={22} tintColor={tone} />
      ) : (
        <View style={[styles.radio, { borderColor: theme.tertiary }]} />
      )}
      {/* The row takes the tap, not the text. */}
      <View pointerEvents="none" style={styles.optionText}>
        <SafeMarkdown selectable={false}>{text}</SafeMarkdown>
      </View>
    </Pressable>
  )
}

function Feedback({ question, chosen }: { question: QuizQuestion; chosen: number }) {
  const theme = useAppTheme()
  const correct = chosen === question.answer
  return (
    <View style={[styles.feedback, { backgroundColor: theme.fill }]}>
      <Text style={[styles.feedbackLabel, { color: correct ? theme.green : theme.red }]}>{correct ? 'Correct' : 'Not quite'}</Text>
      {question.explanation ? <SafeMarkdown compact selectable={Platform.OS !== 'android'}>{question.explanation}</SafeMarkdown> : null}
    </View>
  )
}

function Hint({ text }: { text: string }) {
  const theme = useAppTheme()
  const [open, setOpen] = useState(false)
  return (
    <View style={styles.hint}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={6} onPress={() => setOpen((value) => !value)} style={styles.hintTrigger}>
        <SymbolView name="lightbulb.fill" size={14} tintColor={theme.orange} />
        <Text style={[styles.hintLabel, { color: theme.secondary }]}>{open ? 'Hide hint' : 'Show hint'}</Text>
      </Pressable>
      {open ? <SafeMarkdown compact selectable={Platform.OS !== 'android'}>{text}</SafeMarkdown> : null}
    </View>
  )
}

const DOT_SIZE = 30
const DOT_GAP = 6

function QuestionDots({ quiz, answers, current, onSelect }: { quiz: Quiz; answers: QuizProgress['answers']; current: number | null; onSelect: (question: number) => void }) {
  const theme = useAppTheme()
  const scroll = useRef<ScrollView>(null)
  // Keeps the current question in view in a long quiz.
  useEffect(() => {
    if (current !== null) scroll.current?.scrollTo({ x: Math.max(0, (current - 2) * (DOT_SIZE + DOT_GAP)), animated: true })
  }, [current])
  return (
    <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} style={styles.dotsScroll} contentContainerStyle={styles.dots}>
      {quiz.questions.map((question, index) => {
        const chosen = answers[index]
        const tone = chosen === undefined ? null : chosen === question.answer ? theme.green : theme.red
        const state = chosen === undefined ? '' : chosen === question.answer ? ', correct' : ', incorrect'
        return (
          <Pressable
            accessibilityLabel={`Question ${index + 1}${state}`}
            accessibilityRole="button"
            accessibilityState={{ selected: index === current }}
            hitSlop={3}
            key={index}
            onPress={() => onSelect(index)}
            style={({ pressed }) => [
              styles.dot,
              { backgroundColor: tone ? `${tone}26` : theme.fillStrong, borderColor: index === current ? theme.text : 'transparent' },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.dotLabel, { color: tone ?? theme.secondary }]}>{index + 1}</Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

function QuizResults({ quiz, progress, progressKey }: { quiz: Quiz; progress: QuizProgress; progressKey: string }) {
  const theme = useAppTheme()
  const sendToComposer = useContext(QuizComposerContext)
  const update = useQuizProgress((state) => state.update)
  const retake = useQuizProgress((state) => state.retake)
  const { correct, total } = quizScore(quiz, progress.answers)
  return (
    <View style={[styles.body, styles.results]}>
      <Text accessibilityLabel={`${correct} of ${total} correct`} style={[styles.score, { color: theme.text }]}>{`${correct}/${total}`}</Text>
      <Text style={[styles.scoreDetail, { color: theme.secondary }]}>{correct === total ? 'All correct' : `${Math.round((correct / total) * 100)}% correct`}</Text>
      <QuestionDots quiz={quiz} answers={progress.answers} current={null} onSelect={(question) => update(progressKey, { question, finished: false })} />
      <View style={styles.resultActions}>
        {sendToComposer ? <PrimaryButton label="Send results" icon="paperplane.fill" onPress={() => sendToComposer(quizResultsMessage(quiz, progress.answers))} /> : null}
        <PrimaryButton label="Retake" icon="arrow.counterclockwise" variant="secondary" onPress={() => retake(progressKey)} />
      </View>
    </View>
  )
}

function Flashcards({ cards, index, onChange }: { cards: Flashcard[]; index: number; onChange: (card: number) => void }) {
  const theme = useAppTheme()
  const current = Math.min(index, cards.length - 1)
  // Which card shows its back; moving to another card shows its front.
  const [flipped, setFlipped] = useState<number | null>(null)
  const card = cards[current]!
  const back = flipped === current
  return (
    <View style={styles.body}>
      <Pressable
        accessibilityHint={back ? 'Shows the front' : 'Shows the back'}
        accessibilityRole="button"
        onPress={() => setFlipped(back ? null : current)}
        style={({ pressed }) => [styles.flashcard, { backgroundColor: theme.elevated, borderColor: theme.separator }, pressed && styles.pressed]}
      >
        <Text style={[styles.face, { color: theme.secondary }]}>{back ? 'Back' : 'Front'}</Text>
        <View pointerEvents="none" style={styles.faceText}>
          <SafeMarkdown large={!back} selectable={false}>{back ? card.back : card.front}</SafeMarkdown>
        </View>
        <Text style={[styles.flipHint, { color: theme.tertiary }]}>Tap to flip</Text>
      </Pressable>
      <View style={styles.cardNav}>
        <RoundButton disabled={current === 0} icon="chevron.left" label="Previous card" onPress={() => onChange(current - 1)} />
        <Text style={[styles.cardCount, { color: theme.secondary }]}>{`${current + 1} / ${cards.length}`}</Text>
        <RoundButton disabled={current === cards.length - 1} icon="chevron.right" label="Next card" onPress={() => onChange(current + 1)} />
      </View>
    </View>
  )
}

function RoundButton({ icon, label, onPress, disabled = false, color }: { icon: string; label: string; onPress: () => void; disabled?: boolean; color?: string }) {
  const theme = useAppTheme()
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.roundButton, { backgroundColor: theme.fillStrong }, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <SymbolView name={icon as never} size={14} tintColor={color ?? theme.text} weight="semibold" />
    </Pressable>
  )
}

/** Share the quiz as a `.quiz` file, or save it into My files. */
function QuizExportActions({ quiz }: { quiz: Quiz }) {
  const theme = useAppTheme()
  const queryClient = useQueryClient()
  const namespace = useFilesNamespace()
  const filesEnabled = useFilesEnabled()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const share = () => {
    void shareQuiz(quiz).catch((error) => Alert.alert('Couldn’t share', filesErrorMessage(error)))
  }
  const save = () => {
    setSaving(true)
    void saveQuizToFiles(quiz, namespace, queryClient)
      .then(() => {
        setSaved(true)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        AccessibilityInfo.announceForAccessibility('Saving to My files')
      })
      .catch((error) => Alert.alert('Couldn’t save to Files', filesErrorMessage(error)))
      .finally(() => setSaving(false))
  }
  return (
    <View style={styles.headerActions}>
      <RoundButton icon="square.and.arrow.up" label="Share quiz" onPress={share} color={theme.secondary} />
      {namespace && filesEnabled ? (
        <RoundButton
          disabled={saving || saved}
          icon={saved ? 'checkmark' : 'folder.badge.plus'}
          label={saved ? 'Saved to Files' : 'Save to Files'}
          onPress={save}
          color={saved ? theme.green : theme.secondary}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { width: '100%', marginVertical: 4, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6, minHeight: 48 },
  title: { flex: 1, fontSize: 15, fontWeight: '600' },
  headerActions: { flexDirection: 'row', gap: 8 },
  modes: { paddingHorizontal: 14, paddingBottom: 4 },
  body: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 14, gap: 10 },
  counter: { fontSize: 12.5, fontWeight: '600' },
  options: { gap: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 10 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5 },
  optionText: { flex: 1, minWidth: 0 },
  feedback: { borderRadius: 12, padding: 12, gap: 4 },
  feedbackLabel: { fontSize: 14, fontWeight: '600' },
  hint: { gap: 6 },
  hintTrigger: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  hintLabel: { fontSize: 14, fontWeight: '500' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  dotsScroll: { flex: 1 },
  dots: { gap: DOT_GAP, paddingVertical: 2 },
  dot: { width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  dotLabel: { fontSize: 12, fontWeight: '600' },
  pill: { borderRadius: 16, paddingHorizontal: 16, minHeight: 34, alignItems: 'center', justifyContent: 'center' },
  pillLabel: { fontSize: 14, fontWeight: '600' },
  results: { alignItems: 'center' },
  score: { fontSize: 34, fontWeight: '700', letterSpacing: -0.5, marginTop: 4 },
  scoreDetail: { fontSize: 14 },
  resultActions: { alignSelf: 'stretch', gap: 8, marginTop: 4 },
  flashcard: { minHeight: 170, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 8 },
  face: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  faceText: { flex: 1, justifyContent: 'center' },
  flipHint: { fontSize: 12, textAlign: 'center' },
  cardNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18 },
  cardCount: { fontSize: 14, fontWeight: '500', minWidth: 56, textAlign: 'center' },
  roundButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  building: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: 52 },
  buildingLabel: { fontSize: 15, fontWeight: '500' },
  dimmed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.6 },
})
