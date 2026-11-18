import { Platform } from 'react-native'
import { Section, Text, Toggle } from '@expo/ui/swift-ui'
import { foregroundStyle } from '@expo/ui/swift-ui/modifiers'
import { MaterialToggleRow } from '../../../platform/MaterialUI'
import { showActions } from '../../../platform/materialActions'
import { NativeChoiceRow } from '../../../platform/NativeChoiceRow'
import { usePreferencesStore } from '../../../store/preferences'
import { Card, ListRow, SectionTitle } from '../components/PrototypeUI'
import { modelSubtitle } from '../modelIdentity'
import { usePrototypeStore } from '../store/prototypeStore'

export function ModelSettings() {
  const catalog = usePrototypeStore(state => state.models)
  const catalogReady = usePrototypeStore(state => state.modelCatalogReady)
  const defaultModelId = usePrototypeStore(state => state.defaultModelId)
  const setDefaultModel = usePrototypeStore(state => state.setDefaultModel)
  const setFavoriteModel = usePrototypeStore(state => state.setFavoriteModel)
  const favoriteModelIds = usePreferencesStore(state => state.favoriteModelIds)
  const models = catalog.filter(model => model.enabled)
  const defaultModel = models.find(model => model.id === defaultModelId) ?? models[0]

  if (!defaultModel) {
    const message = catalogReady ? 'No chat models available.' : 'Loading models…'
    return Platform.OS === 'ios'
      ? <Section><Text modifiers={[foregroundStyle('secondary')]}>{message}</Text></Section>
      : <Card><ListRow title={message} last /></Card>
  }

  const defaultOptions = models.map(model => ({ value: model.id, label: model.name }))
  const defaultDetail = 'Used when starting a new chat.'
  const favoritesDetail = 'Favorites appear in the chat model picker.'
  if (Platform.OS === 'ios') return <>
    <Section footer={<Text>{defaultDetail}</Text>}>
      <NativeChoiceRow title="Default model" icon="bubble.left" value={defaultModel.id} options={defaultOptions} onChange={setDefaultModel} />
    </Section>
    <Section title="Favorite models" footer={<Text>{favoritesDetail}</Text>}>
      {models.map(model => <Toggle
        key={model.id}
        isOn={favoriteModelIds.includes(model.id)}
        onIsOnChange={favorite => setFavoriteModel(model.id, favorite)}
      >
        <Text>{model.name}</Text>
        <Text modifiers={[foregroundStyle('secondary')]}>{modelSubtitle(model)}</Text>
      </Toggle>)}
    </Section>
  </>

  return <>
    <Card>
      <ListRow title="Default model" icon="bubble.left" value={defaultModel.name} detail={defaultDetail} last
        onPress={() => showActions('Default model', defaultOptions.map(option => ({
          label: option.label,
          selected: option.value === defaultModel.id,
          onPress: () => setDefaultModel(option.value),
        })))}
      />
    </Card>
    <SectionTitle>Favorite models</SectionTitle>
    <Card>
      {models.map(model => <MaterialToggleRow
        key={model.id}
        title={model.name}
        detail={modelSubtitle(model)}
        value={favoriteModelIds.includes(model.id)}
        onChange={favorite => setFavoriteModel(model.id, favorite)}
      />)}
    </Card>
  </>
}
