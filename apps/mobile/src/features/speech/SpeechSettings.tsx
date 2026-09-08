import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { speechPriceLabel, type PublicSpeechModel } from '@pulpo/contracts'
import { apiRequest } from '../../api/client'
import { usePreferencesStore } from '../../store/preferences'
import { useSessionStore } from '../../store/session'
import { usePrototypeStore } from '../../mockup5/src/store/prototypeStore'
import { useAppTheme } from '../../mockup5/src/theme'
import { Screen, PageHeader } from '../../mockup5/src/components/PrototypeUI'

export function SpeechSettings({ onBack }: { onBack: () => void }) {
  const theme = useAppTheme()
  const preferences = usePreferencesStore(s => s.speech)
  const setPreference = usePrototypeStore(s => s.setPreference)
  const instanceUrl = useSessionStore(s => s.instanceUrl)
  const userId = useSessionStore(s => s.user?.id)
  const [picker, setPicker] = useState<'model' | 'voice' | null>(null)
  const catalog = useQuery({ queryKey: ['speech-models', instanceUrl, userId], queryFn: () => apiRequest<{ data: PublicSpeechModel[] }>('/api/speech-models') })
  const model = catalog.data?.data.find(m => m.id === preferences.modelId)
  const settings = model ? preferences.models[model.id] ?? { instructions: '', speed: 1 } : undefined
  const update = (patch: object) => { if (model) setPreference('speech', { ...preferences, models: { ...preferences.models, [model.id]: { ...settings!, ...patch } } }) }
  const textStyle = { color: theme.text, fontSize: 16 }
  const fieldStyle = { color: theme.text, backgroundColor: theme.fillStrong, borderRadius: 10, padding: 12, minHeight: 48 }
  return <Screen><PageHeader title="Speech" onBack={onBack} /><View style={{ gap: 18 }}>
    <Text style={{ color: theme.secondary }}>Read messages aloud with an AI-generated voice.</Text>
    {catalog.isError && <Pressable onPress={() => void catalog.refetch()}><Text style={textStyle}>Speech models could not be loaded. Tap to retry.</Text></Pressable>}
    <Pressable accessibilityRole="button" onPress={() => setPicker(picker === 'model' ? null : 'model')}><Text style={textStyle}>Model</Text><Text style={fieldStyle}>{model?.name ?? (preferences.modelId ? 'Selected model unavailable' : catalog.isLoading ? 'Loading…' : 'Choose a speech model')}</Text></Pressable>
    {picker === 'model' && catalog.data?.data.map(m => <Pressable key={m.id} accessibilityRole="button" onPress={() => { setPreference('speech', { ...preferences, modelId: m.id }); setPicker(null) }}><Text style={fieldStyle}>{m.name}{model?.id === m.id ? ' ✓' : ''}</Text></Pressable>)}
    {catalog.data?.data.length === 0 && <Text style={textStyle}>An admin must configure a speech model first.</Text>}
    {model && settings && <>
      <Pressable accessibilityRole="button" onPress={() => setPicker(picker === 'voice' ? null : 'voice')}><Text style={textStyle}>Voice</Text><Text style={fieldStyle}>{model.voices.find(v => v.id === (settings.voice ?? model.defaultVoice))?.label ?? 'Selected voice unavailable'}</Text></Pressable>
      {picker === 'voice' && model.voices.map(voice => <Pressable key={voice.id} accessibilityRole="button" onPress={() => { update({ voice: voice.id }); setPicker(null) }}><Text style={fieldStyle}>{voice.label}</Text></Pressable>)}
      {model.supportsInstructions && <View style={{ gap: 8 }}><Text style={textStyle}>Instructions</Text><TextInput accessibilityLabel="Speech instructions" style={fieldStyle} multiline maxLength={4096} value={settings.instructions} onChangeText={instructions => update({ instructions })} placeholder="Speak in a calm, friendly tone." placeholderTextColor={theme.secondary} /></View>}
      {model.supportsSpeed && <View style={{ gap: 8 }}><Text style={textStyle}>Speed: {settings.speed}×</Text><View style={{ flexDirection: 'row', gap: 20 }}><Pressable accessibilityRole="button" accessibilityLabel="Decrease speech speed" onPress={() => update({ speed: Math.max(model.speedMin, Math.round((settings.speed - 0.1) * 100) / 100) })}><Text style={fieldStyle}>−</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Increase speech speed" onPress={() => update({ speed: Math.min(model.speedMax, Math.round((settings.speed + 0.1) * 100) / 100) })}><Text style={fieldStyle}>+</Text></Pressable></View></View>}
      <Text style={textStyle}>{speechPriceLabel(model)}</Text><Text style={{ color: theme.secondary }}>Charges apply to generated audio, including a prepared next chunk when playback stops.</Text>
    </>}
  </View></Screen>
}
