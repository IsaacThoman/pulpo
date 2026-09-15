import { useEffect, useState, useSyncExternalStore } from 'react'
import { ActivityIndicator, Platform, Text, View } from 'react-native'
import { Button, HStack, LabeledContent, ProgressView, Section, Stepper, Text as NativeText, TextField, useNativeState } from '@expo/ui/swift-ui'
import { accessibilityLabel, accessibilityValue, disabled, foregroundStyle, textFieldStyle } from '@expo/ui/swift-ui/modifiers'
import { useQuery } from '@tanstack/react-query'
import { SPEECH_MAX_INSTRUCTIONS_LENGTH, type SpeechCatalog } from '@pulpo/contracts'
import { apiRequest } from '../../api/client'
import { usePreferencesStore } from '../../store/preferences'
import { useSessionStore } from '../../store/session'
import { usePrototypeStore } from '../../mockup5/src/store/prototypeStore'
import { useAppTheme } from '../../mockup5/src/theme'
import { Card, Field, ListRow, SectionTitle } from '../../mockup5/src/components/PrototypeUI'
import { MaterialButton, MaterialIconButton } from '../../platform/MaterialUI'
import { SpeechPicker } from './SpeechPicker'
import { previewSpeech, speechPlayback } from './playback'

function SpeechInstructions({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const text = useNativeState(value)
  const [focused, setFocused] = useState(false)
  // Native text can advance ahead of React during typing; only apply external
  // values when editing ends so delayed renders cannot overwrite newer input.
  useEffect(() => { if (!focused && text.get() !== value) text.set(value) }, [focused, text, value])
  return <TextField text={text} onFocusChange={setFocused} onTextChange={onChange} axis="vertical" maxLength={SPEECH_MAX_INSTRUCTIONS_LENGTH}
    placeholder="Speak in a calm, friendly tone." modifiers={[textFieldStyle('plain'), accessibilityLabel('Speech instructions')]} />
}

/** Sections embedded in the Personalization form (iOS) or settings screen (Android). */
export function SpeechSettings() {
  const theme = useAppTheme()
  const playback = useSyncExternalStore(speechPlayback.subscribe, speechPlayback.getSnapshot)
  const preferences = usePreferencesStore(s => s.speech)
  useEffect(() => () => { if (speechPlayback.getSnapshot().key?.startsWith('preview:')) speechPlayback.stop() }, [preferences])
  const setPreference = usePrototypeStore(s => s.setPreference)
  const instanceUrl = useSessionStore(s => s.instanceUrl)
  const userId = useSessionStore(s => s.user?.id)
  const catalog = useQuery({ queryKey: ['speech-models', instanceUrl, userId], queryFn: () => apiRequest<SpeechCatalog>('/api/speech-models') })
  const model = catalog.data?.data.find(m => m.id === (preferences.modelId ?? catalog.data?.defaultModelId))
  const settings = model ? preferences.models[model.id] ?? { instructions: '', speed: 1 } : undefined
  const update = (patch: object) => { if (model) setPreference('speech', { ...preferences, models: { ...preferences.models, [model.id]: { ...settings!, ...patch } } }) }
  const changeSpeed = (speed: number) => { if (model) update({ speed: Math.max(model.speedMin, Math.min(model.speedMax, Math.round(speed * 100) / 100)) }) }
  const resetVoice = () => { speechPlayback.stop(); update({ voice: undefined }) }
  const previewing = playback.key === 'preview:settings'
  const canPreview = Boolean(model?.voices.some(voice => voice.id === (settings?.voice ?? model.defaultVoice)))
  const previewLabel = previewing ? 'Stop preview' : 'Preview speech'
  const modelPicker = <SpeechPicker label="Model" value={preferences.modelId ?? model?.id}
    placeholder={preferences.modelId ? 'Selected model unavailable' : 'Choose a model'}
    options={catalog.data?.data.map(option => ({ id: option.id, label: option.name })) ?? []}
    onChange={modelId => { speechPlayback.stop(); setPreference('speech', { ...preferences, modelId }) }} />
  const voicePicker = model && settings && <SpeechPicker key={model.id} label="Voice" value={settings.voice ?? model.defaultVoice}
    placeholder="Selected voice unavailable" options={model.voices}
    onChange={voice => { speechPlayback.stop(); update({ voice }) }} />

  if (Platform.OS === 'ios') return <>
    <Section title="Speech" footer={<NativeText modifiers={[foregroundStyle('secondary')]}>Read messages aloud with an AI-generated voice.</NativeText>}>
      {catalog.isError ? <Button label="Speech models could not be loaded. Tap to retry." onPress={() => void catalog.refetch()} />
        : catalog.isLoading ? <LabeledContent label="Model"><ProgressView /></LabeledContent> : modelPicker}
      {catalog.data?.data.length === 0 && <NativeText modifiers={[foregroundStyle('secondary')]}>An admin must configure a speech model first.</NativeText>}
      {voicePicker}
      {settings?.voice !== undefined && <Button label="Use default voice" onPress={resetVoice} />}
      {/* Expo's SwiftUI stepper stores integers; use hundredths for decimal speeds. */}
      {model?.supportsSpeed && settings && <Stepper label={`Speed: ${settings.speed}×`} value={Math.round(settings.speed * 100)} step={10} min={Math.ceil(model.speedMin * 100)} max={Math.floor(model.speedMax * 100)} onValueChange={value => changeSpeed(value / 100)} modifiers={[accessibilityValue(`${settings.speed}×`)]} />}
    </Section>
    {model?.supportsInstructions && settings && <Section title="Speech instructions">
      <SpeechInstructions key={model.id} value={settings.instructions} onChange={instructions => update({ instructions })} />
    </Section>}
    <Section>
      <HStack spacing={8}>
        <Button label={previewLabel} systemImage={previewing ? 'stop.fill' : 'play.fill'} modifiers={[disabled(!canPreview && !previewing)]} onPress={() => { if (previewing) speechPlayback.stop(); else void previewSpeech() }} />
        {previewing && playback.phase === 'loading' && <ProgressView />}
      </HStack>
      {previewing && playback.phase === 'loading' && <NativeText modifiers={[foregroundStyle('secondary')]}>Generating speech…</NativeText>}
      {playback.error && <NativeText>{playback.error}</NativeText>}
    </Section>
  </>

  return <>
    <SectionTitle>Speech</SectionTitle>
    <Card>
      {catalog.isError ? <MaterialButton label="Speech models could not be loaded. Tap to retry." variant="secondary" onPress={() => void catalog.refetch()} />
        : <ListRow title="Model">{catalog.isLoading ? <ActivityIndicator color={theme.secondary} /> : modelPicker}</ListRow>}
      {catalog.data?.data.length === 0 && <ListRow title="An admin must configure a speech model first." last />}
      {voicePicker && <ListRow title="Voice" last={!model?.supportsSpeed}>{voicePicker}</ListRow>}
      {settings?.voice !== undefined && <ListRow title="Use default voice" onPress={resetVoice} />}
      {model?.supportsSpeed && settings && <ListRow title="Speed" value={`${settings.speed}×`} last>
        <View style={{ flexDirection: 'row' }}>
          <MaterialIconButton icon="remove" label="Decrease speech speed" disabled={settings.speed <= model.speedMin} onPress={() => changeSpeed(settings.speed - 0.1)} />
          <MaterialIconButton icon="plus" label="Increase speech speed" disabled={settings.speed >= model.speedMax} onPress={() => changeSpeed(settings.speed + 0.1)} />
        </View>
      </ListRow>}
    </Card>
    <Text style={{ color: theme.secondary, paddingHorizontal: 16 }}>Read messages aloud with an AI-generated voice.</Text>
    {model?.supportsInstructions && settings && <><SectionTitle>Speech instructions</SectionTitle><Field accessibilityLabel="Speech instructions" multiline maxLength={SPEECH_MAX_INSTRUCTIONS_LENGTH} value={settings.instructions} onChangeText={instructions => update({ instructions })} placeholder="Speak in a calm, friendly tone." /></>}
    <Card>
      <MaterialButton label={previewLabel} variant="secondary" disabled={!canPreview && !previewing} onPress={() => { if (previewing) speechPlayback.stop(); else void previewSpeech() }} />
      {previewing && playback.phase === 'loading' && <View style={{ flexDirection: 'row', gap: 8, padding: 16 }}><ActivityIndicator color={theme.secondary} /><Text style={{ color: theme.secondary }}>Generating speech…</Text></View>}
      {playback.error && <Text accessibilityRole="alert" style={{ color: theme.text, padding: 16 }}>{playback.error}</Text>}
    </Card>
  </>
}
