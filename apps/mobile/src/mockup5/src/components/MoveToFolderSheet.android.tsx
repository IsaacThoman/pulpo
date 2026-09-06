import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { usePrototypeStore } from '../store/prototypeStore';
import { useAppTheme } from '../theme';
import { MaterialField, MaterialRow, MaterialDialog } from '../../../platform/MaterialUI';
export function MoveToFolderSheet({ chatId, folderId, folders, onClose }: {chatId: string; folderId: string | null; folders: {id: string; name: string}[]; onClose: () => void}) {
  const theme = useAppTheme();
  const moveChat = usePrototypeStore((state) => state.moveChat);
  const [query, setQuery] = useState('');
  const visible = folders.filter((folder) => folder.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const move = (id: string | null) => { moveChat(chatId, id); onClose(); };
  return <MaterialDialog visible title="Move to folder" onClose={onClose} contentHeight={96 + (visible.length + 1) * 56}><View style={{ flex: 1, gap: 12 }}>
    <MaterialField label="Search folders" icon="magnifyingglass" value={query} onChangeText={setQuery} />
    <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }}><MaterialRow title="No folder" icon="folder" selected={folderId === null} onPress={() => move(null)} />
      {visible.map((folder) => <MaterialRow key={folder.id} title={folder.name} icon="folder" selected={folderId === folder.id} onPress={() => move(folder.id)} />)}
      {!visible.length ? <Text style={{ color: theme.secondary, padding: 16 }}>{query ? 'No matching folders' : 'No folders yet'}</Text> : null}
    </ScrollView>
  </View></MaterialDialog>;
}
