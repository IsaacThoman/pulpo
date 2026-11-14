import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { SymbolView } from '../../../platform/SymbolView'
import { useAppTheme } from '../../../theme'
import { fileIcon } from '../display'
import type { FileMentionSuggestion } from '../mentions'

interface Props {
  /** What the word after `@` searched for; empty lists recent items. */
  query: string
  suggestions: readonly FileMentionSuggestion[]
  onChoose: (suggestion: FileMentionSuggestion) => void
}

/**
 * Files items matching the `@` word being typed, in a compact list just above the message field.
 * It sits outside any scroll view and its rows are plain buttons, so tapping one leaves the field
 * focused and the keyboard up.
 */
export function FileMentionList({ query, suggestions, onChoose }: Props) {
  const theme = useAppTheme()
  if (!suggestions.length) return null
  return (
    <View accessibilityLabel={query ? 'Files items to mention' : 'Recent Files items to mention'} style={[styles.list, { backgroundColor: theme.fill }]}>
      <Text style={[styles.title, { color: theme.secondary }]}>{query ? 'Mention from Files' : 'Recent in Files'}</Text>
      {suggestions.map((suggestion, index) => {
        const icon = fileIcon(suggestion.node)
        const place = suggestion.parent?.name ?? 'My files'
        return (
          <Pressable
            key={suggestion.node.id}
            accessibilityRole="button"
            accessibilityLabel={`Mention ${suggestion.node.name}, in ${place}`}
            android_ripple={{ color: theme.fillStrong }}
            onPress={() => onChoose(suggestion)}
            style={({ pressed }) => [
              styles.row,
              index > 0 && { borderTopColor: theme.separator, borderTopWidth: StyleSheet.hairlineWidth },
              pressed && Platform.OS !== 'android' && { backgroundColor: theme.fillStrong },
            ]}
            testID={`file-mention-${suggestion.node.name}`}
          >
            <SymbolView name={icon.symbol as never} size={17} tintColor={icon.tint} />
            <Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>{suggestion.node.name}</Text>
            <Text numberOfLines={1} style={[styles.place, { color: theme.secondary }]}>{place}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { borderRadius: 14, overflow: 'hidden', marginBottom: 8 },
  title: { fontSize: 12, fontWeight: '500', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  row: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 },
  name: { flex: 1, fontSize: 15 },
  place: { maxWidth: '40%', fontSize: 13 },
})
