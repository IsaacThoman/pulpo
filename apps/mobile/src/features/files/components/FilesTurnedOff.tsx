import { StyleSheet, Text, View } from 'react-native'
import { SymbolView } from '../../../platform/SymbolView'
import { useAppTheme } from '../../../theme'

/** What Files screens show while an administrator has Files turned off. */
export function FilesTurnedOff() {
  const theme = useAppTheme()
  return (
    <View style={[styles.center, { backgroundColor: theme.background }]}>
      <SymbolView name="folder.badge.questionmark" size={44} tintColor={theme.tertiary} />
      <Text style={[styles.title, { color: theme.text }]}>Files are turned off</Text>
      <Text style={[styles.body, { color: theme.secondary }]}>Your administrator has turned off Files for this instance.</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
})
