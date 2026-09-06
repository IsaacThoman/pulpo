import { ScrollView, StyleSheet, Text, View, type ViewProps } from 'react-native';
import { MaterialMenu } from '../platform/MaterialUI';
import { useAppTheme } from '../theme';
import type { QueueAction } from './QueuedMessagesView';
import { queueRowActions, type QueueRow } from './queueRowActions';

export function QueuedMessagesView({ rows, maxHeight, onAction, style, ...props }: ViewProps & {
  rows: QueueRow[];
  maxHeight: number;
  onAction: (event: { nativeEvent: QueueAction }) => void;
}) {
  const theme = useAppTheme();
  return <ScrollView {...props} style={[style, { maxHeight }]} nestedScrollEnabled keyboardShouldPersistTaps="handled">
    {rows.map((row, index) => <View key={row.id} style={[styles.row, { backgroundColor: row.isEditing ? theme.fillStrong : 'transparent' }]}>
      <View style={styles.copy}><Text numberOfLines={2} style={{ color: theme.text, fontSize: 14 }}>{row.content}</Text>
        {row.detail ? <Text numberOfLines={2} style={{ color: row.status === 'failed' ? theme.red : theme.secondary, fontSize: 12 }}>{row.detail}</Text> : null}
      </View>
      <MaterialMenu label={`Actions for ${row.kind === 'shelf' ? 'shelved draft' : 'queued message'} ${index + 1}`} icon="ellipsis" actions={queueRowActions(rows, index).map((action) => ({ ...action, onPress: () => onAction({ nativeEvent: action.event }) }))} />
    </View>)}
  </ScrollView>;
}
const styles = StyleSheet.create({ row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingLeft: 12, borderRadius: 16 }, copy: { flex: 1, gap: 4, paddingVertical: 8 } });
