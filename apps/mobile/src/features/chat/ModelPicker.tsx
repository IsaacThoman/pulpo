import { useMemo, useState } from 'react'
import { Modal, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SymbolView } from 'expo-symbols'
import * as Haptics from 'expo-haptics'
import { GlassIconButton } from '../../components/PrototypeUI'
import { ModelMark } from '../../components/ModelMark'
import { usePreferencesStore } from '../../store/preferences'
import { useAppTheme } from '../../theme'
import type { MobileModel } from '../../types'

export function ModelPicker({ visible, models, selectedId, onClose, onSelect }: {
  visible: boolean
  models: MobileModel[]
  selectedId: string | null
  onClose: () => void
  onSelect: (model: MobileModel) => void
}) {
  const theme = useAppTheme()
  const favorites = usePreferencesStore((state) => state.favoriteModelIds)
  const defaultModelId = usePreferencesStore((state) => state.defaultModelId)
  const setPreference = usePreferencesStore((state) => state.setPreference)
  const [query, setQuery] = useState('')
  const filtered = models.filter((model) => `${model.name} ${model.provider.name} ${model.lab?.name ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  const sections = useMemo(() => {
    const result: Array<{ title: string; data: MobileModel[] }> = []
    const favoriteModels = filtered.filter((model) => favorites.includes(model.id))
    if (favoriteModels.length) result.push({ title: 'Favorites', data: favoriteModels })
    const groups = new Map<string, MobileModel[]>()
    for (const model of filtered) {
      const name = model.lab?.name ?? model.provider.name
      groups.set(name, [...(groups.get(name) ?? []), model])
    }
    for (const [title, data] of groups) result.push({ title, data })
    return result
  }, [favorites, filtered])
  const toggleFavorite = async (id: string) => {
    await Haptics.selectionAsync()
    await setPreference('favoriteModelIds', favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id])
  }
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <View style={styles.header}><View><Text style={[styles.title, { color: theme.text }]}>Choose a model</Text><Text style={[styles.subtitle, { color: theme.secondary }]}>{models.length} available on this instance</Text></View><GlassIconButton icon="xmark" label="Close model picker" onPress={onClose} /></View>
      <View style={[styles.search, { backgroundColor: theme.fillStrong }]}><SymbolView name="magnifyingglass" size={16} tintColor={theme.secondary} /><TextInput value={query} onChangeText={setQuery} placeholder="Search models" placeholderTextColor={theme.secondary} style={[styles.input, { color: theme.text }]} /></View>
      <SectionList
        sections={sections}
        keyExtractor={(model, index) => `${model.id}-${index}`}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        renderSectionHeader={({ section }) => <Text style={[styles.section, { color: theme.secondary }]}>{section.title}</Text>}
        renderItem={({ item: model }) => <Pressable onPress={() => { void Haptics.selectionAsync(); onSelect(model) }} onLongPress={() => { void toggleFavorite(model.id) }} style={({ pressed }) => [styles.row, { borderColor: theme.separator }, pressed && { backgroundColor: theme.fill }]}>
          <ModelMark model={model} size={38} /><View style={{ flex: 1 }}><Text style={[styles.name, { color: theme.text }]}>{model.name}</Text><Text numberOfLines={1} style={[styles.detail, { color: theme.secondary }]}>{model.description || model.provider.name}</Text></View>
          {defaultModelId === model.id ? <Text style={[styles.default, { color: theme.secondary }]}>Default</Text> : null}
          <Pressable accessibilityLabel={favorites.includes(model.id) ? 'Remove favorite' : 'Add favorite'} onPress={() => { void toggleFavorite(model.id) }} hitSlop={10}><SymbolView name={favorites.includes(model.id) ? 'star.fill' : 'star'} size={18} tintColor={favorites.includes(model.id) ? theme.orange : theme.secondary} /></Pressable>
          {selectedId === model.id ? <SymbolView name="checkmark.circle.fill" size={20} tintColor={theme.green} /> : null}
        </Pressable>}
      />
      {selectedId ? <Pressable onPress={() => { void setPreference('defaultModelId', selectedId) }} style={[styles.defaultButton, { backgroundColor: theme.fillStrong }]}><Text style={{ color: theme.text, fontWeight: '700' }}>{defaultModelId === selectedId ? 'Selected model is the default' : 'Make selected model the default'}</Text></Pressable> : null}
    </SafeAreaView>
  </Modal>
}

const styles = StyleSheet.create({
  root: { flex: 1 }, header: { height: 72, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 }, subtitle: { fontSize: 12, marginTop: 3 }, search: { minHeight: 44, borderRadius: 13, marginHorizontal: 18, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, input: { flex: 1, fontSize: 15 }, list: { paddingHorizontal: 18, paddingBottom: 86 }, section: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7, paddingTop: 20, paddingBottom: 7 }, row: { minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 11 }, name: { fontSize: 15, fontWeight: '700' }, detail: { fontSize: 12, marginTop: 3 }, default: { fontSize: 11 }, defaultButton: { position: 'absolute', bottom: 26, left: 18, right: 18, minHeight: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
})
