import { useEffect, useState, useSyncExternalStore } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { speechPriceLabel, type PublicSpeechModel } from '@pulpo/contracts'
import { apiRequest } from '../../api/client'
import { usePreferencesStore } from '../../store/preferences'
import { useSessionStore } from '../../store/session'
import { usePrototypeStore } from '../../mockup5/src/store/prototypeStore'
import { useAppTheme } from '../../mockup5/src/theme'
import { Screen, PageHeader, GlassIconButton } from '../../mockup5/src/components/PrototypeUI'

import { previewSpeechModel, speechPlayback } from './playback'

export function SpeechSettings({ onBack }: { onBack: () => void }) {
  const theme = useAppTheme()
  const playback = useSyncExternalStore(speechPlayback.subscribe, speechPlayback.getSnapshot)
  useEffect(() => () => { if (speechPlayback.getSnapshot().key?.startsWith('preview:')) speechPlayback.stop() }, [])
  const preferences = usePreferencesStore(s => s.speech)
  const setPreference = usePrototypeStore(s => s.setPreference)
  const instanceUrl = useSessionStore(s => s.instanceUrl)
  const userId = useSessionStore(s => s.user?.id)
  const [picker, setPicker] = useState<'voice' | null>(null)
  const catalog = useQuery({ queryKey: ['speech-models', instanceUrl, userId], queryFn: () => apiRequest<{ data: PublicSpeechModel[] }>('/api/speech-models') })
  const model = catalog.data?.data.find(m => m.id === preferences.modelId)
  const settings = model ? preferences.models[model.id] ?? { instructions: '', speed: 1 } : undefined
  const update = (patch: object) => { if (model) setPreference('speech', { ...preferences, models: { ...preferences.models, [model.id]: { ...settings!, ...patch } } }) }
  const textStyle = { color: theme.text, fontSize: 16 }
  const fieldStyle = { color: theme.text, backgroundColor: theme.fillStrong, borderRadius: 10, padding: 12, minHeight: 48 }
  return <Screen><PageHeader title="Speech" onBack={onBack} /><View style={{ gap: 18 }}>
    <Text style={{ color: theme.secondary }}>Read messages aloud with an AI-generated voice.</Text>
    {catalog.isError && <Pressable onPress={() => void catalog.refetch()}><Text style={textStyle}>Speech models could not be loaded. Tap to retry.</Text></Pressable>}
    <View style={{ gap: 8 }}>
      <Text style={textStyle}>Model</Text>
      {catalog.isLoading && <ActivityIndicator color={theme.secondary} />}
      {preferences.modelId && !model && !catalog.isLoading && <Text style={{ color: theme.secondary }}>Selected model unavailable</Text>}
      {catalog.data?.data.map(option => {
        const selected = preferences.modelId === option.id
        const active = playback.key === `preview:${option.id}`
        return <View key={option.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 12, backgroundColor: selected ? theme.fillStrong : theme.elevated }}>
          <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => { speechPlayback.stop(); setPreference('speech', { ...preferences, modelId: option.id }) }} style={{ flex: 1, paddingVertical: 14 }}>
            <Text style={{ ...textStyle, fontWeight: '600' }}>{option.name}{selected ? ' ✓' : ''}</Text>
            <Text style={{ color: theme.secondary, fontSize: 12, marginTop: 4 }}>{speechPriceLabel(option)}</Text>
          </Pressable>
          {option.previewAvailable && <View>
            <GlassIconButton icon={active ? 'stop.fill' : 'play.fill'} label={active ? 'Stop preview' : `Preview ${option.name}`} onPress={() => { void previewSpeechModel(option.id) }} />
            {active && playback.phase === 'loading' && <ActivityIndicator pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0 }} size="small" color={theme.secondary} />}
          </View>}
        </View>
      })}
      <Text style={{ color: theme.secondary, fontSize: 12 }}>Previews are uploaded samples. Free to play.</Text>
      {playback.error && <Text accessibilityRole="alert" style={{ color: theme.text }}>{playback.error}</Text>}
    </View>
    {catalog.data?.data.length === 0 && <Text style={textStyle}>An admin must configure a speech model first.</Text>}
    {model && settings && <>
      <Pressable accessibilityRole="button" onPress={() => setPicker(picker === 'voice' ? null : 'voice')}><Text style={textStyle}>Voice</Text><Text style={fieldStyle}>{model.voices.find(v => v.id === (settings.voice ?? model.defaultVoice))?.label ?? 'Selected voice unavailable'}</Text></Pressable>
      {picker === 'voice' && model.voices.map(voice => <Pressable key={voice.id} accessibilityRole="button" onPress={() => { update({ voice: voice.id }); setPicker(null) }}><Text style={fieldStyle}>{voice.label}</Text></Pressable>)}
      {model.supportsInstructions && <View style={{ gap: 8 }}><Text style={textStyle}>Instructions</Text><TextInput accessibilityLabel="Speech instructions" style={fieldStyle} multiline maxLength={4096} value={settings.instructions} onChangeText={instructions => update({ instructions })} placeholder="Speak in a calm, friendly tone." placeholderTextColor={theme.secondary} /></View>}
      {model.supportsSpeed && <View style={{ gap: 8 }}><Text style={textStyle}>Speed: {settings.speed}×</Text><View style={{ flexDirection: 'row', gap: 20 }}><Pressable accessibilityRole="button" accessibilityLabel="Decrease speech speed" onPress={() => update({ speed: Math.max(model.speedMin, Math.round((settings.speed - 0.1) * 100) / 100) })}><Text style={fieldStyle}>−</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Increase speech speed" onPress={() => update({ speed: Math.min(model.speedMax, Math.round((settings.speed + 0.1) * 100) / 100) })}><Text style={fieldStyle}>+</Text></Pressable></View></View>}
      <Text style={{ color: theme.secondary }}>Charges apply to generated audio, including a prepared next chunk when playback stops.</Text>
    </>}
  </View></Screen>
}
