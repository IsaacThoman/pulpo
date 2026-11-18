import { Fragment } from 'react'
import { Platform } from 'react-native'
import { Button, HStack, Image, Section, Spacer, Text, Toggle, VStack } from '@expo/ui/swift-ui'
import { accessibilityValue, buttonStyle, contentShape, font, foregroundStyle, shapes } from '@expo/ui/swift-ui/modifiers'
import { FAVORITES_SECTION, resolveModelMenu } from '../../../features/chat/modelMenu'
import { MaterialRow, MaterialToggleRow } from '../../../platform/MaterialUI'
import { usePreferencesStore } from '../../../store/preferences'
import { Card, ListRow, SectionTitle } from '../components/PrototypeUI'
import { modelSubtitle } from '../modelIdentity'
import { usePrototypeStore } from '../store/prototypeStore'

function useChatModels() {
  const catalog = usePrototypeStore(state => state.models)
  const defaultModelId = usePrototypeStore(state => state.defaultModelId)
  const models = catalog.filter(model => model.enabled)
  const defaultModel = models.find(model => model.id === defaultModelId) ?? models[0]
  return { models, defaultModel }
}

function ModelCatalogStatus() {
  const catalogReady = usePrototypeStore(state => state.modelCatalogReady)
  const message = catalogReady ? 'No chat models available.' : 'Loading models…'
  return Platform.OS === 'ios'
    ? <Section><Text modifiers={[foregroundStyle('secondary')]}>{message}</Text></Section>
    : <Card><ListRow title={message} last /></Card>
}

export function ModelSettings({ onChooseDefault }: { onChooseDefault: () => void }) {
  const { models, defaultModel } = useChatModels()
  const setFavoriteModel = usePrototypeStore(state => state.setFavoriteModel)
  const favoriteModelIds = usePreferencesStore(state => state.favoriteModelIds)

  if (!defaultModel) return <ModelCatalogStatus />
  const defaultDetail = 'Used when starting a new chat.'
  const favoritesDetail = 'Favorites appear in the chat model picker.'
  if (Platform.OS === 'ios') return <>
    <Section footer={<Text>{defaultDetail}</Text>}>
      <Button onPress={onChooseDefault} modifiers={[buttonStyle('plain'), foregroundStyle('primary')]}>
        <HStack spacing={12} modifiers={[contentShape(shapes.rectangle())]}>
          <Image systemName="bubble.left" size={17} />
          <Text>Default model</Text>
          <Spacer />
          <Text modifiers={[foregroundStyle('secondary')]}>{defaultModel.name}</Text>
          <Image systemName="chevron.right" size={11} modifiers={[foregroundStyle('secondary')]} />
        </HStack>
      </Button>
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
        onPress={onChooseDefault}
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

export function DefaultModelPicker({ onSelect }: { onSelect: () => void }) {
  const { models, defaultModel } = useChatModels()
  const favoriteIds = usePreferencesStore(state => state.favoriteModelIds)
  const providerOrder = usePreferencesStore(state => state.providerOrder)
  const setDefaultModel = usePrototypeStore(state => state.setDefaultModel)
  const { sections, visibleModels: favorites } = resolveModelMenu(models, favoriteIds, providerOrder, FAVORITES_SECTION)

  if (!defaultModel) return <ModelCatalogStatus />

  return sections.map(section => {
    const isFavorites = section.id === FAVORITES_SECTION
    const choices = isFavorites ? favorites : models.filter(model => model.providerGroupId === section.id)
    if (choices.length === 0) return null

    const rows = choices.map(model => {
      const selected = model.id === defaultModel.id
      const choose = () => {
        setDefaultModel(model.id)
        onSelect()
      }
      const detail = isFavorites || model.lab !== model.provider ? modelSubtitle(model) : undefined
      return Platform.OS === 'ios'
        ? <Button key={model.id} onPress={choose} modifiers={[
          buttonStyle('plain'), foregroundStyle('primary'), ...(selected ? [accessibilityValue('Selected')] : []),
        ]}>
          <HStack spacing={12} modifiers={[contentShape(shapes.rectangle())]}>
            <VStack alignment="leading" spacing={2}>
              <Text>{model.name}</Text>
              {detail && <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary')]}>{detail}</Text>}
            </VStack>
            <Spacer />
            {selected && <Image systemName="checkmark" size={14} modifiers={[foregroundStyle('tint')]} />}
          </HStack>
        </Button>
        : <MaterialRow key={model.id} title={model.name} detail={detail} selected={selected} onPress={choose} />
    })

    return Platform.OS === 'ios'
      ? <Section key={section.id} title={section.label}>{rows}</Section>
      : <Fragment key={section.id}>
        <SectionTitle>{section.label}</SectionTitle>
        <Card>{rows}</Card>
      </Fragment>
  })
}
