import { ActivityIndicator, Platform, Pressable, Switch, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Host, Menu, Button, Text as NativeText } from '@expo/ui/swift-ui'
import { buttonStyle, foregroundStyle } from '@expo/ui/swift-ui/modifiers'
import { imagePriceLabel, type PublicImageModel } from '@pulpo/contracts'
import { apiRequest } from '../../api/client'
import { usePreferencesStore } from '../../store/preferences'
import { useSessionStore } from '../../store/session'
import { usePrototypeStore } from '../../mockup5/src/store/prototypeStore'
import { useAppTheme } from '../../mockup5/src/theme'
import { Screen, PageHeader } from '../../mockup5/src/components/PrototypeUI'
import { MaterialMenu } from '../../platform/MaterialUI'

export function ImageGenerationSettings({ onBack }: { onBack: () => void }) {
  const theme = useAppTheme()
  const preferences = usePreferencesStore(state => state.imageGeneration)
  const setPreference = usePrototypeStore(state => state.setPreference)
  const instanceUrl = useSessionStore(state => state.instanceUrl)
  const userId = useSessionStore(state => state.user?.id)
  const catalog = useQuery({ queryKey: ['image-models', instanceUrl, userId], queryFn: () => apiRequest<{ data: PublicImageModel[] }>('/api/image-models') })
  const model = catalog.data?.data.find(entry => entry.id === preferences.modelId)
  const label = model?.name ?? (preferences.modelId ? 'Selected model unavailable' : 'Choose a model')
  const textStyle = { color: theme.text, fontSize: 16 }
  const select = (modelId: string) => setPreference('imageGeneration', { ...preferences, modelId })
  return <Screen>{Platform.OS !== 'ios' && <PageHeader title="Image generation" onBack={onBack} />}<View style={{ gap: 18 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><Text style={{ ...textStyle, flex: 1 }}>Enable image generation</Text><Switch accessibilityLabel="Enable image generation" value={preferences.enabled} disabled={!model && !preferences.enabled} onValueChange={enabled => setPreference('imageGeneration', { ...preferences, enabled })} /></View>
    <View style={{ gap: 8 }}><Text style={textStyle}>Image model</Text>
      {catalog.isLoading ? <ActivityIndicator color={theme.secondary} /> : Platform.OS === 'ios' ? <Host style={{ height: 48, width: '100%' }}><Menu label={<NativeText>{label}</NativeText>} modifiers={[buttonStyle('bordered'), foregroundStyle('primary')]}>{catalog.data?.data.map(entry => <Button key={entry.id} label={entry.name} systemImage={entry.id === model?.id ? 'checkmark' : undefined} onPress={() => select(entry.id)} />)}</Menu></Host> : <MaterialMenu label="Image model" icon="chevron.down" text={label} actions={catalog.data?.data.map(entry => ({ id: entry.id, label: entry.name, selected: entry.id === model?.id, onPress: () => select(entry.id) }))} />}
      {model && <Text style={{ color: theme.secondary }}>{imagePriceLabel(model)}</Text>}
    </View>
    {catalog.isError && <Pressable accessibilityRole="button" onPress={() => void catalog.refetch()}><Text style={textStyle}>Image models could not be loaded. Tap to retry.</Text></Pressable>}
    {catalog.data?.data.length === 0 && <Text style={{ color: theme.secondary }}>An admin must configure an image model first.</Text>}
    {preferences.modelId && !model && catalog.isSuccess && <Text style={{ color: theme.secondary }}>Your selected image model is unavailable. Choose another model to generate images.</Text>}
  </View></Screen>
}
