import { useEffect, useState } from 'react'
import { Platform, Text } from 'react-native'
import { Button, Section, Text as NativeText, TextField, Toggle, useNativeState } from '@expo/ui/swift-ui'
import { accessibilityLabel, foregroundStyle, lineLimit, textFieldStyle, tint } from '@expo/ui/swift-ui/modifiers'
import { useQuery } from '@tanstack/react-query'
import { CUSTOM_INSTRUCTIONS_MAX_LENGTH, type InstructionPreset } from '@pulpo/contracts'
import { instructionPresetEnabled } from '@pulpo/client-core'
import { apiRequest } from '../../api/client'
import { usePreferencesStore } from '../../store/preferences'
import { useSessionStore } from '../../store/session'
import { usePrototypeStore } from '../../mockup5/src/store/prototypeStore'
import { useAppTheme } from '../../mockup5/src/theme'
import { Card, Field, SectionTitle } from '../../mockup5/src/components/PrototypeUI'
import { MaterialButton, MaterialToggleRow } from '../../platform/MaterialUI'

const placeholder = 'e.g. Be terse. Prefer code over prose. Never apologize.'
const instructionsHelp = 'Appended to every conversation as a system prompt.'
const presetsHelp = 'Turn on preset behaviors your administrator has set up. They apply to every conversation.'
const presetsError = 'Instruction presets could not be loaded. Tap to retry.'

function NativeInstructionsField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const text = useNativeState(value)
  const [focused, setFocused] = useState(false)
  // Native text can advance ahead of React during typing; only apply external
  // values when editing ends so delayed renders cannot overwrite newer input.
  useEffect(() => { if (!focused && text.get() !== value) text.set(value) }, [focused, text, value])
  return <TextField text={text} onFocusChange={setFocused} onTextChange={onChange} axis="vertical" maxLength={CUSTOM_INSTRUCTIONS_MAX_LENGTH}
    placeholder={placeholder} modifiers={[textFieldStyle('plain'), lineLimit({ min: 4, max: 12 }), accessibilityLabel('Custom instructions')]} />
}

/** Custom instructions and admin instruction presets, synced with the account like the web. */
export function CustomInstructionsSettings() {
  const theme = useAppTheme()
  const customInstructions = usePreferencesStore(s => s.customInstructions)
  const selections = usePreferencesStore(s => s.instructionPresetSelections)
  const setPreference = usePrototypeStore(s => s.setPreference)
  const instanceUrl = useSessionStore(s => s.instanceUrl)
  const userId = useSessionStore(s => s.user?.id)
  const presets = useQuery({
    queryKey: ['instruction-presets', instanceUrl, userId],
    queryFn: () => apiRequest<{ instructionPresets?: InstructionPreset[] }>('/api/settings'),
    select: (data) => data.instructionPresets ?? [],
  })
  const setInstructions = (value: string) => setPreference('customInstructions', value)
  const togglePreset = (presetId: string, enabled: boolean) => setPreference('instructionPresetSelections', { ...selections, [presetId]: enabled })
  const presetList = presets.data ?? []

  if (Platform.OS === 'ios') return <>
    <Section title="Custom instructions" footer={<NativeText modifiers={[foregroundStyle('secondary')]}>{instructionsHelp}</NativeText>}>
      <NativeInstructionsField value={customInstructions} onChange={setInstructions} />
    </Section>
    {presets.isError ? <Section title="Instruction presets"><Button label={presetsError} onPress={() => void presets.refetch()} /></Section>
      : presetList.length > 0 && <Section title="Instruction presets" footer={<NativeText modifiers={[foregroundStyle('secondary')]}>{presetsHelp}</NativeText>}>
        {presetList.map(preset => <Toggle key={preset.id} label={preset.title} isOn={instructionPresetEnabled(preset, selections)}
          onIsOnChange={enabled => togglePreset(preset.id, enabled)} modifiers={[tint(preset.color)]} />)}
      </Section>}
  </>

  return <>
    <SectionTitle>Custom instructions</SectionTitle>
    <Field accessibilityLabel="Custom instructions" multiline maxLength={CUSTOM_INSTRUCTIONS_MAX_LENGTH} value={customInstructions} onChangeText={setInstructions} placeholder={placeholder} />
    <Text style={{ color: theme.secondary, paddingHorizontal: 16 }}>{instructionsHelp}</Text>
    {presets.isError ? <><SectionTitle>Instruction presets</SectionTitle><Card><MaterialButton label={presetsError} variant="secondary" onPress={() => void presets.refetch()} /></Card></>
      : presetList.length > 0 && <>
        <SectionTitle>Instruction presets</SectionTitle>
        <Card>{presetList.map(preset => <MaterialToggleRow key={preset.id} title={preset.title} value={instructionPresetEnabled(preset, selections)} onChange={enabled => togglePreset(preset.id, enabled)} />)}</Card>
        <Text style={{ color: theme.secondary, paddingHorizontal: 16 }}>{presetsHelp}</Text>
      </>}
  </>
}
