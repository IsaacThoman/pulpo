import { Platform, Text } from 'react-native'
import { Button, Section, Text as NativeText, Toggle } from '@expo/ui/swift-ui'
import { disabled, foregroundStyle } from '@expo/ui/swift-ui/modifiers'
import { useQuery } from '@tanstack/react-query'
import { imagePriceLabel, type PublicImageModel } from '@pulpo/contracts'
import { apiRequest } from '../../api/client'
import { usePreferencesStore } from '../../store/preferences'
import { useSessionStore } from '../../store/session'
import { usePrototypeStore } from '../../mockup5/src/store/prototypeStore'
import { useAppTheme } from '../../mockup5/src/theme'
import { Card, ListRow, SectionTitle } from '../../mockup5/src/components/PrototypeUI'
import { MaterialButton, MaterialToggleRow } from '../../platform/MaterialUI'
import { SpeechPicker as ModelPicker } from '../speech/SpeechPicker'

export function ImageGenerationSettings() {
  const theme = useAppTheme()
  const preferences = usePreferencesStore(s => s.imageGeneration)
  const setPreference = usePrototypeStore(s => s.setPreference)
  const instanceUrl = useSessionStore(s => s.instanceUrl)
  const userId = useSessionStore(s => s.user?.id)
  const catalog = useQuery({ queryKey: ['image-models', instanceUrl, userId], queryFn: () => apiRequest<{ data: PublicImageModel[] }>('/api/image-models') })
  const model = catalog.data?.data.find(entry => entry.id === preferences.modelId)
  const changeEnabled = (enabled: boolean) => { if (model || !enabled) setPreference('imageGeneration', { ...preferences, enabled }) }
  const picker = <ModelPicker label="Image model" value={model?.id} placeholder={catalog.isLoading ? 'Loading models…' : preferences.modelId ? 'Selected model unavailable' : 'Choose a model'}
    options={catalog.data?.data.map(entry => ({ id: entry.id, label: entry.name })) ?? []}
    onChange={modelId => setPreference('imageGeneration', { ...preferences, modelId })} />
  const help = model ? imagePriceLabel(model) : catalog.data?.data.length === 0 ? 'An admin must configure an image model first.'
    : preferences.modelId && catalog.isSuccess ? 'Your selected image model is unavailable. Choose another model to generate images.' : 'Choose a model to generate images in agent mode.'
  if (Platform.OS === 'ios') return <Section title="Image generation" footer={<NativeText modifiers={[foregroundStyle('secondary')]}>{help}</NativeText>}>
    <Toggle label="Enable image generation" isOn={preferences.enabled} onIsOnChange={changeEnabled} modifiers={[disabled(!model && !preferences.enabled)]} />
    {catalog.isError ? <Button label="Image models could not be loaded. Tap to retry." onPress={() => void catalog.refetch()} /> : picker}
  </Section>
  return <>
    <SectionTitle>Image generation</SectionTitle><Card>
      <MaterialToggleRow title="Enable image generation" value={preferences.enabled} onChange={changeEnabled} />
      {catalog.isError ? <MaterialButton label="Image models could not be loaded. Tap to retry." variant="secondary" onPress={() => void catalog.refetch()} /> : <ListRow title="Image model" last>{picker}</ListRow>}
    </Card><Text style={{ color: theme.secondary, paddingHorizontal: 16 }}>{help}</Text>
  </>
}
