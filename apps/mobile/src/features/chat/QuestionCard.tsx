import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { getValue, setValue } from '../../data/database'
import { answerQuestion, emptyQuestionDraft, navigateQuestion, questionSubmission, restoreQuestionDraft, type QuestionDraft } from '@pulpo/client-core'
import { questionAnswerText, type AnswerQuestions, type QuestionItem, type ResponseSnapshot } from '@pulpo/contracts'
import { useAppTheme } from '../../mockup5/src/theme'
import { apiRequest } from '../../api/client'
import { useRealtimeStore } from '../../providers/realtimeStore'

export type QuestionCardControl = { setText: (text: string) => void; answerText: (text: string) => void }

export function QuestionCard({ item, namespace, persistDraft = true, controlRef, onTextChange }: {
  item: QuestionItem; namespace: string; persistDraft?: boolean; controlRef?: Ref<QuestionCardControl>; onTextChange: (text: string) => void
}) {
  const theme = useAppTheme()
  const { height } = useWindowDimensions()
  const [keyboardHeight, setKeyboardHeight] = useState(() => Keyboard?.metrics?.()?.height ?? 0)
  const scrollRef = useRef<ScrollView>(null)
  useEffect(() => {
    if (!Keyboard?.addListener) return
    const subscriptions = [
      Keyboard.addListener('keyboardWillChangeFrame', event => setKeyboardHeight(Math.max(0, height - event.endCoordinates.screenY))),
      Keyboard.addListener('keyboardDidShow', event => setKeyboardHeight(event.endCoordinates.height)),
      Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0)),
    ]
    return () => subscriptions.forEach(subscription => subscription.remove())
  }, [height])
  const storageKey = `pulpo:questions:${namespace}:${item.id}`
  const initialItem = useRef(item).current
  const [draft, setDraft] = useState<QuestionDraft>(emptyQuestionDraft)
  const [hydrated, setHydrated] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const writes = useRef(Promise.resolve())
  const [error, setError] = useState('')
  const question = item.questions[draft.index]!
  const selected = draft.answers[question.id]
  useEffect(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }) }, [draft.index])
  const answers = questionSubmission(item, draft)
  useEffect(() => {
    let live = true
    void (persistDraft ? getValue(namespace, storageKey) : Promise.resolve(null)).then(raw => { if (live) setDraft(restoreQuestionDraft(initialItem, raw)) }).catch(() => undefined).finally(() => { if (live) setHydrated(true) })
    return () => { live = false }
  }, [storageKey, initialItem, namespace, persistDraft]) // The parent keys the card by question set.
  useEffect(() => {
    if (!hydrated) return
    if (persistDraft) writes.current = writes.current.then(() => setValue(namespace, storageKey, draft)).catch(() => undefined)
    onTextChange(draft.text)
  }, [draft, hydrated, storageKey, onTextChange, namespace, persistDraft])
  useImperativeHandle(controlRef, () => ({
    setText: text => { if (hydrated && !busyRef.current) setDraft(current => ({ ...current, text })) },
    answerText: text => { if (hydrated && text.trim() && !busyRef.current) setDraft(current => answerQuestion(item, current, { kind: 'text', text: text.trim() })) },
  }), [item, hydrated])
  const resolve = async (input: AnswerQuestions) => {
    if (busyRef.current || !hydrated) return
    busyRef.current = true; setBusy(true); setError('')
    try {
      const snapshot = await apiRequest<ResponseSnapshot>(`/api/responses/${item.responseId}/questions/${item.id}/answer`, { method: 'POST', body: input })
      useRealtimeStore.getState().receiveSnapshot(snapshot)
      await writes.current
      if (persistDraft) await setValue(namespace, storageKey, null)
    } catch (failure) {
      try { useRealtimeStore.getState().receiveSnapshot(await apiRequest<ResponseSnapshot>(`/api/responses/${item.responseId}`)) } catch { /* Preserve the local draft offline. */ }
      setError(failure instanceof Error ? failure.message : 'Unable to submit answers. Try again.')
    } finally { busyRef.current = false; setBusy(false) }
  }
  const button = (label: string, action: () => void, disabled = false, prominent = false, accessibilityLabel = label) => <Pressable
    accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: disabled || busy || !hydrated }}
    disabled={disabled || busy || !hydrated} onPress={action}
    style={({ pressed }) => [styles.button, { backgroundColor: prominent ? theme.accent : pressed ? theme.fillStrong : 'transparent', opacity: disabled || busy || !hydrated ? 0.4 : 1 }]}>
    <Text style={{ color: prominent ? theme.accentText : theme.secondary, fontSize: 14, fontWeight: prominent ? '600' : '400' }}>{label}</Text>
  </Pressable>
  return <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" nestedScrollEnabled accessibilityLabel="Agent questions" contentContainerStyle={{ padding: 14 }} style={[styles.card, { maxHeight: Math.max(160, height - keyboardHeight - 220), backgroundColor: theme.elevated, borderColor: theme.separator }]}>
    <View style={styles.header}>
      <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[styles.prompt, { color: theme.text }]}>{question.prompt}</Text>
      <View style={styles.navigation}>
        {button('‹', () => setDraft(navigateQuestion(item, draft, draft.index - 1)), draft.index === 0, false, 'Previous question')}
        <Text style={{ color: theme.secondary, fontSize: 12 }}>{draft.index + 1} / {item.questions.length}</Text>
        {button('›', () => setDraft(navigateQuestion(item, draft, draft.index + 1)), draft.index === item.questions.length - 1, false, 'Next question')}
        {button('×', () => { void resolve({ action: 'skip_all' }) }, false, false, 'Skip all questions')}
      </View>
    </View>
    <View>
      {question.options?.map((option, index) => {
        const checked = !draft.text && selected?.kind === 'option' && selected.index === index
        return <Pressable key={index} accessibilityRole="button" accessibilityState={{ selected: checked, disabled: busy || !hydrated }} disabled={busy || !hydrated}
          onPress={() => setDraft(answerQuestion(item, draft, { kind: 'option', index }))}
          style={({ pressed }) => [styles.option, { backgroundColor: checked || pressed ? theme.fillStrong : 'transparent' }]}>
          <View style={[styles.number, { borderColor: theme.separator }]}><Text style={{ color: theme.secondary }}>{index + 1}</Text></View>
          <View style={styles.optionBody}><View style={styles.optionTitle}><Text style={{ color: theme.text, fontSize: 15, fontWeight: '500', flexShrink: 1 }}>{option.label}</Text>{option.recommended && <Text style={[styles.badge, { color: theme.secondary, backgroundColor: theme.fill }]}>Recommended</Text>}</View>
            {option.description && <Text style={{ color: theme.secondary, fontSize: 14, marginTop: 4 }}>{option.description}</Text>}
          </View>
        </Pressable>
      })}
    </View>
    <View style={[styles.custom, { backgroundColor: theme.fill }]}>
      <TextInput accessibilityLabel="Custom answer" placeholder="Something else…" placeholderTextColor={theme.tertiary} multiline maxLength={10_000} editable={!busy && hydrated}
        value={draft.text} onChangeText={text => setDraft({ ...draft, text })} style={[styles.input, { color: theme.text }]} />
      {button('Use answer', () => setDraft(answerQuestion(item, draft, { kind: 'text', text: draft.text.trim() })), !draft.text.trim())}
    </View>
    <Text accessibilityLiveRegion="polite" style={{ color: theme.secondary, fontSize: 12, marginTop: 10 }}>Waiting for your answer</Text>
    <View style={styles.footer}>
      {button('Skip all', () => { void resolve({ action: 'skip_all' }) })}
      {button('Skip', () => setDraft(answerQuestion(item, draft, { kind: 'skipped' })))}
      {button(busy ? 'Submitting…' : 'Submit', () => { if (answers) void resolve({ action: 'submit', answers }) }, !answers, true)}
    </View>
    {!!error && <Text accessibilityRole="alert" style={{ color: theme.red, marginTop: 8 }}>{error}</Text>}
  </ScrollView>
}

export function QuestionSummary({ item }: { item: QuestionItem }) {
  const theme = useAppTheme()
  const [expanded, setExpanded] = useState(false)
  return <View style={[styles.summary, { borderColor: theme.separator }]}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: theme.secondary }}>{item.status === 'pending' ? 'Waiting for your answer' : item.status === 'cancelled' ? 'Questions cancelled' : item.status === 'skipped' ? 'Questions skipped' : 'Your answers'} {expanded ? '⌃' : '⌄'}</Text>
    </Pressable>
    {expanded && item.questions.map(q => <View key={q.id} style={{ marginBottom: 10 }}><Text style={{ color: theme.text, fontWeight: '500' }}>{q.prompt}</Text><Text style={{ color: theme.secondary, marginTop: 4 }}>{item.status === 'pending' ? 'Awaiting answer' : questionAnswerText(q, item.answers[q.id])}</Text></View>)}
  </View>
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 24, flexGrow: 0, marginBottom: 10 },
  header: { gap: 6, marginBottom: 8 },
  prompt: { fontSize: 17, fontWeight: '600', flexShrink: 1 },
  navigation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  button: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', borderRadius: 22 },
  option: { flexDirection: 'row', gap: 10, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 14 },
  number: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  optionBody: { flex: 1, minWidth: 0 }, optionTitle: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  badge: { fontSize: 12, borderRadius: 6, paddingVertical: 3, paddingHorizontal: 6 },
  custom: { flexDirection: 'row', alignItems: 'flex-end', borderRadius: 16, padding: 4, marginTop: 8 },
  input: { flex: 1, minWidth: 0, minHeight: 44, maxHeight: 100, fontSize: 15, padding: 10 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  summary: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 12, marginVertical: 8 },
})
