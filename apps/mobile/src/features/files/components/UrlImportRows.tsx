import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useAppTheme } from '../../../theme'
import { urlImportLabel, type PendingUrlImport } from '../urlImport'

/** Pages being imported into a folder, shown like its uploads until the document arrives. */
export function UrlImportRows({ items }: { items: readonly PendingUrlImport[] }) {
  const theme = useAppTheme()
  return items.map((item) => {
    const label = urlImportLabel(item.url)
    return (
      <View key={item.id} accessible accessibilityLabel={`${label}, importing`} style={styles.row} testID="files-url-import-row">
        <ActivityIndicator size="small" color={theme.secondary} />
        <View style={styles.text}>
          <Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>{label}</Text>
          <Text numberOfLines={1} style={[styles.state, { color: theme.secondary }]}>Importing…</Text>
        </View>
      </View>
    )
  })
}

// As the folder's upload rows.
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 24, paddingRight: 16, minHeight: 60 },
  text: { flex: 1 },
  name: { fontSize: 17 },
  state: { fontSize: 13, marginTop: 1 },
})
