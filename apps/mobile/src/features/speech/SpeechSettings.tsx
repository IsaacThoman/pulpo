import { useEffect, useState, useSyncExternalStore } from 'react'
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import type { PublicSpeechModel } from '@pulpo/contracts'
import { apiRequest } from '../../api/client'
import { usePreferencesStore } from '../../store/preferences'
import { useSessionStore } from '../../store/session'
import { usePrototypeStore } from '../../mockup5/src/store/prototypeStore'
import { useAppTheme } from '../../mockup5/src/theme'
import { Screen, PageHeader, GlassIconButton } from '../../mockup5/src/components/PrototypeUI'

import { Host, Menu, Button, Text as NativeText } from '@expo/ui/swift-ui'
import { buttonStyle, foregroundStyle } from '@expo/ui/swift-ui/modifiers'
import { MaterialMenu } from '../../platform/MaterialUI'
import { SymbolView } from '../../platform/SymbolView'
import { previewSpeechVoice, speechPlayback } from './playback'

export function SpeechSettings({ onBack }: { onBack: () => void }) {
  const [openVoiceModel, setOpenVoiceModel] = useState<string | null>(null)
  const closeVoices = () => {
    setOpenVoiceModel(null)
    if (speechPlayback.getSnapshot().key?.startsWith('preview:')) speechPlayback.stop()
  }
  const theme = useAppTheme()
  const playback = useSyncExternalStore(speechPlayback.subscribe, speechPlayback.getSnapshot)
  useEffect(() => () => { if (speechPlayback.getSnapshot().key?.startsWith('preview:')) speechPlayback.stop() }, [])
  const preferences = usePreferencesStore(s => s.speech)
  const setPreference = usePrototypeStore(s => s.setPreference)
  const instanceUrl = useSessionStore(s => s.instanceUrl)
  const userId = useSessionStore(s => s.user?.id)
  const catalog = useQuery({ queryKey: ['speech-models', instanceUrl, userId], queryFn: () => apiRequest<{ data: PublicSpeechModel[] }>('/api/speech-models') })
  const model = catalog.data?.data.find(m => m.id === preferences.modelId)
  const settings = model ? preferences.models[model.id] ?? { instructions: '', speed: 1 } : undefined
  const update = (patch: object) => { if (model) setPreference('speech', { ...preferences, models: { ...preferences.models, [model.id]: { ...settings!, ...patch } } }) }
  const textStyle = { color: theme.text, fontSize: 16 }
  const fieldStyle = { color: theme.text, backgroundColor: theme.fillStrong, borderRadius: 10, padding: 12, minHeight: 48 }
  return <Screen>{Platform.OS !== 'ios' && <PageHeader title="Speech" onBack={onBack} />}<View style={{ gap: 18 }}>
    <Text style={{ color: theme.secondary }}>Read messages aloud with an AI-generated voice.</Text>
    {catalog.isError && <Pressable onPress={() => void catalog.refetch()}><Text style={textStyle}>Speech models could not be loaded. Tap to retry.</Text></Pressable>}
    <View style={{ gap: 8 }}>
      <Text style={textStyle}>Model</Text>
      {catalog.isLoading ? <ActivityIndicator color={theme.secondary} /> : Platform.OS === 'ios' ? <Host style={{ height: 48, width: '100%' }}>
        <Menu label={<NativeText>{model?.name ?? (preferences.modelId ? 'Selected model unavailable' : 'Choose a model')}</NativeText>} modifiers={[buttonStyle('bordered'), foregroundStyle('primary')]}>
          {catalog.data?.data.map(option => <Button key={option.id} label={option.name} systemImage={option.id === model?.id ? 'checkmark' : undefined} onPress={() => { closeVoices(); speechPlayback.stop(); setPreference('speech', { ...preferences, modelId: option.id }) }} />)}
        </Menu>
      </Host> : <MaterialMenu label="Model" icon="chevron.down" text={model?.name ?? (preferences.modelId ? 'Selected model unavailable' : 'Choose a model')} actions={catalog.data?.data.map(option => ({ id: option.id, label: option.name, selected: option.id === model?.id, onPress: () => { closeVoices(); speechPlayback.stop(); setPreference('speech', { ...preferences, modelId: option.id }) } }))} />}
    </View>
    {catalog.data?.data.length === 0 && <Text style={textStyle}>An admin must configure a speech model first.</Text>}
    {model && settings && <>
      <View style={{ gap: 8 }}>
        <Text style={textStyle}>Voice</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Voice: ${model.voices.find(voice => voice.id === (settings.voice ?? model.defaultVoice))?.label ?? 'Selected voice unavailable'}`} accessibilityState={{ expanded: openVoiceModel === model.id }} onPress={() => { if (openVoiceModel === model.id) closeVoices(); else setOpenVoiceModel(model.id) }} style={{ ...fieldStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={{ ...textStyle, flex: 1 }}>{model.voices.find(voice => voice.id === (settings.voice ?? model.defaultVoice))?.label ?? 'Selected voice unavailable'}</Text>
          <SymbolView name={openVoiceModel === model.id ? 'chevron.up' : 'chevron.down'} tintColor={theme.secondary} size={16} />
        </Pressable>
        {openVoiceModel === model.id && <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 320, borderRadius: 12, backgroundColor: theme.elevated }} contentContainerStyle={{ gap: 4, padding: 4 }}>
        {model.voices.map(voice => {
          const selected = (settings.voice ?? model.defaultVoice) === voice.id
          const active = playback.key === `preview:${model.id}:${voice.id}`
          return <View key={voice.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 12, backgroundColor: selected ? theme.fillStrong : theme.elevated }}>
            <Pressable accessibilityRole="radio" accessibilityLabel={voice.label} accessibilityState={{ checked: selected }} onPress={() => { closeVoices(); speechPlayback.stop(); update({ voice: voice.id }) }} style={{ flex: 1, paddingVertical: 14 }}>
              <Text style={{ ...textStyle, fontWeight: '600' }}>{voice.label}{selected ? ' ✓' : ''}</Text>
            </Pressable>
            {voice.previewAvailable && <View>
              <GlassIconButton icon={active ? 'stop.fill' : 'play.fill'} label={active ? 'Stop preview' : `Preview ${voice.label}`} onPress={() => { void previewSpeechVoice(model.id, voice.id) }} />
              {active && playback.phase === 'loading' && <ActivityIndicator pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0 }} size="small" color={theme.secondary} />}
            </View>}
          </View>
        })}
        </ScrollView>}
        {playback.error && <Text accessibilityRole="alert" style={{ color: theme.text }}>{playback.error}</Text>}
      </View>
      {model.supportsInstructions && <View style={{ gap: 8 }}><Text style={textStyle}>Instructions</Text><TextInput accessibilityLabel="Speech instructions" style={fieldStyle} multiline maxLength={4096} value={settings.instructions} onChangeText={instructions => update({ instructions })} placeholder="Speak in a calm, friendly tone." placeholderTextColor={theme.secondary} /></View>}
      {model.supportsSpeed && <View style={{ gap: 8 }}><Text style={textStyle}>Speed: {settings.speed}×</Text><View style={{ flexDirection: 'row', gap: 20 }}><Pressable accessibilityRole="button" accessibilityLabel="Decrease speech speed" onPress={() => update({ speed: Math.max(model.speedMin, Math.round((settings.speed - 0.1) * 100) / 100) })}><Text style={fieldStyle}>−</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Increase speech speed" onPress={() => update({ speed: Math.min(model.speedMax, Math.round((settings.speed + 0.1) * 100) / 100) })}><Text style={fieldStyle}>+</Text></Pressable></View></View>}
    </>}
  </View></Screen>
}
