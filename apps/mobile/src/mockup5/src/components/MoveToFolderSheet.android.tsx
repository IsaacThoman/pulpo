import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useAppTheme } from '../theme';
import { MaterialField, MaterialRow, MaterialDialog } from '../../../platform/MaterialUI';
import type { MoveToFolderSheetProps } from './MoveToFolderSheet';
import { sidebarIndent } from '../../../features/sidebar/layout';
export function MoveToFolderSheet({ folderId, folders, disabledIds, onMove, onOther, onClose }: MoveToFolderSheetProps) {
  const theme = useAppTheme();
  const [query, setQuery] = useState('');
  const search = query.trim().toLocaleLowerCase();
  const visible = folders.filter((folder) => folder.name.toLocaleLowerCase().includes(search));
  const move = (id: string | null) => { onMove(id); onClose(); };
  return <MaterialDialog visible title="Move to folder" onClose={onClose} contentHeight={96 + (visible.length + (onOther ? 2 : 1)) * 56}><View style={{ flex: 1, gap: 12 }}>
    <MaterialField label="Search folders" icon="magnifyingglass" value={query} onChangeText={setQuery} />
    <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }}><MaterialRow title="No folder" icon="folder" selected={folderId === null} onPress={() => move(null)} />
      {visible.map((folder) => <View key={folder.id} style={{ paddingLeft: search ? 0 : sidebarIndent(folder.depth ?? 0), opacity: disabledIds?.has(folder.id) ? 0.4 : 1 }}><MaterialRow title={folder.name} icon="folder" selected={folderId === folder.id} onPress={disabledIds?.has(folder.id) ? undefined : () => move(folder.id)} /></View>)}
      {!visible.length ? <Text style={{ color: theme.secondary, padding: 16 }}>{query ? 'No matching folders' : 'No folders yet'}</Text> : null}
      {onOther ? <MaterialRow title="Other folder…" icon="folder" onPress={() => { onClose(); onOther(); }} /> : null}
    </ScrollView>
  </View></MaterialDialog>;
}
