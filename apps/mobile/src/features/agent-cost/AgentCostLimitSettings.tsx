import { useEffect } from 'react'
import { Platform, View } from 'react-native'
import { HStack, Section, Spacer, Text as NativeText, TextField, Toggle, useNativeState } from '@expo/ui/swift-ui'
import { accessibilityLabel, foregroundStyle, frame, keyboardType, monospacedDigit, multilineTextAlignment, onSubmit, submitLabel, textFieldStyle, tint } from '@expo/ui/swift-ui/modifiers'
import { usePrototypeStore } from '../../mockup5/src/store/prototypeStore'
import { useAppTheme } from '../../mockup5/src/theme'
import { Card, SectionTitle } from '../../mockup5/src/components/PrototypeUI'
import { MaterialField, MaterialToggleRow } from '../../platform/MaterialUI'
import { useCostLimitDraft } from './costLimitDraft'

const TOGGLE_TITLE = 'Enable cost warning threshold'
const THRESHOLD_TITLE = 'Cost threshold'
// Same copy as the web Agent settings.
const HELP = 'Pause for confirmation after an agent loop exceeds set cost threshold. Does not guarantee total cost remains below threshold.'

function NativeCostLimitField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { draft, setDraft, commit } = useCostLimitDraft(value, onChange)
  const nativeText = useNativeState(draft)
  useEffect(() => { if (nativeText.get() !== draft) nativeText.set(draft) }, [draft, nativeText])
  const finish = () => { nativeText.set(commit()) }
  return <HStack spacing={12}>
    <NativeText>{THRESHOLD_TITLE}</NativeText>
    <Spacer />
    <NativeText modifiers={[foregroundStyle('secondary')]}>$</NativeText>
    <TextField text={nativeText} onTextChange={setDraft} onFocusChange={(focused) => { if (!focused) finish() }}
      modifiers={[textFieldStyle('plain'), multilineTextAlignment('trailing'), monospacedDigit(), keyboardType('numbers-and-punctuation'), submitLabel('done'), onSubmit(finish), frame({ width: 90 }), accessibilityLabel('Cost threshold in US dollars')]} />
  </HStack>
}

function MaterialCostLimitField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { draft, setDraft, commit } = useCostLimitDraft(value, onChange)
  return <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
    <MaterialField label="Cost threshold (US dollars)" value={draft} onChangeText={setDraft} onSubmitEditing={() => { commit() }}
      keyboardType="decimal-pad" returnKeyType="done" autoCorrect={false} autoCapitalize="none" />
  </View>
}

/** The Agent cost warning threshold, shared with the web Agent settings. */
export function AgentCostLimitSettings() {
  const theme = useAppTheme()
  const enabled = usePrototypeStore((state) => state.preferences.agentCostLimitEnabled)
  const limit = usePrototypeStore((state) => state.preferences.agentCostLimitMicros)
  const setPreference = usePrototypeStore((state) => state.setPreference)
  const setEnabled = (next: boolean) => setPreference('agentCostLimitEnabled', next)
  const setLimit = (next: number) => setPreference('agentCostLimitMicros', next)
  if (Platform.OS === 'ios') return <Section title="Cost warning" footer={<NativeText modifiers={[foregroundStyle('secondary')]}>{HELP}</NativeText>}>
    <Toggle isOn={enabled} onIsOnChange={setEnabled} label={TOGGLE_TITLE} systemImage="exclamationmark.octagon" modifiers={[tint(theme.green)]} />
    {enabled ? <NativeCostLimitField value={limit} onChange={setLimit} /> : null}
  </Section>
  return <>
    <SectionTitle>Cost warning</SectionTitle>
    <Card>
      <MaterialToggleRow title={TOGGLE_TITLE} detail={HELP} value={enabled} onChange={setEnabled} />
      {enabled ? <MaterialCostLimitField value={limit} onChange={setLimit} /> : null}
    </Card>
  </>
}

