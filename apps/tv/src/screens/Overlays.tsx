import { FlatList, Text, TVFocusGuideView, View } from 'react-native'
import { Focusable } from '../components/Focusable'
import { Icon } from '../components/Icon'
import { ModelIcon } from '../components/ModelIcon'
import { useModels } from '../data'
import { useNavigation, type Overlay } from '../navigation'
import { SAFE, useTVTheme, type } from '../theme'

function ModelPicker({ namespace, overlay }: { namespace: string; overlay: Extract<Overlay, { name: 'models' }> }) {
  const theme = useTVTheme()
  const dismiss = useNavigation((state) => state.dismiss)
  const { models } = useModels(namespace)
  const selectedIndex = Math.max(0, models.findIndex((model) => model.id === overlay.selectedId))
  return <TVFocusGuideView autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={{
    position: 'absolute', top: 0, right: 0, bottom: 0, width: 820,
    backgroundColor: theme.elevated, paddingTop: SAFE.vertical, paddingHorizontal: 50,
  }}>
    <FlatList
      data={models}
      keyExtractor={(model) => model.id}
      initialScrollIndex={selectedIndex}
      getItemLayout={(_, index) => ({ length: 116, offset: 116 * index, index })}
      contentContainerStyle={{ paddingVertical: 20 }}
      renderItem={({ item, index }) => <View style={{ height: 116, justifyContent: 'center' }}>
        <Focusable testID={`model-${item.id}`} hasTVPreferredFocus={index === selectedIndex} lift={1.04}
          onPress={() => { dismiss(); overlay.onSelect(item.id) }}
          style={{ height: 96, borderRadius: 30, paddingHorizontal: 28, justifyContent: 'center', backgroundColor: 'transparent' }}>
          {(focused) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 24 }}>
            <ModelIcon model={item} size={52} inverted={focused} />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: type.body, fontWeight: '600', color: focused ? theme.focusText : theme.text }}>{item.name}</Text>
            {item.id === overlay.selectedId ? <Icon name="checkmark" size={32} color={focused ? theme.focusText : theme.text} /> : null}
          </View>}
        </Focusable>
      </View>}
    />
  </TVFocusGuideView>
}

function ActionSheet({ overlay }: { overlay: Extract<Overlay, { name: 'actions' }> }) {
  const theme = useTVTheme()
  const dismiss = useNavigation((state) => state.dismiss)
  return <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
    <TVFocusGuideView autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={{
      width: 640, borderRadius: 44, padding: 40, gap: 20, backgroundColor: theme.elevated,
    }}>
      {overlay.title ? <Text numberOfLines={1} style={{ fontSize: type.label, fontWeight: '600', color: theme.secondary, textAlign: 'center', marginBottom: 12 }}>{overlay.title}</Text> : null}
      {overlay.actions.map((action, index) => <Focusable key={action.key} testID={`action-${action.key}`} hasTVPreferredFocus={index === 0} lift={1.04}
        onPress={() => { dismiss(); action.run() }}
        style={{ height: 92, borderRadius: 46, paddingHorizontal: 36, justifyContent: 'center' }}>
        {(focused) => {
          const color = focused ? theme.focusText : action.destructive ? theme.red : theme.text
          return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 22 }}>
            <Icon name={action.icon} size={32} color={color} />
            <Text style={{ fontSize: type.body, fontWeight: '600', color }}>{action.label}</Text>
          </View>
        }}
      </Focusable>)}
    </TVFocusGuideView>
  </View>
}

export function Overlays({ namespace }: { namespace: string }) {
  const overlay = useNavigation((state) => state.overlay)
  if (!overlay) return null
  return <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' }}>
    {overlay.name === 'models' ? <ModelPicker namespace={namespace} overlay={overlay} /> : <ActionSheet overlay={overlay} />}
  </View>
}
