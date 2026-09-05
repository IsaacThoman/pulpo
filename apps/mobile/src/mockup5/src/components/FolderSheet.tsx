import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePrototypeStore } from '../store/prototypeStore';
import { useAppTheme } from '../theme';
import type { FolderSort } from './folderSort';

export type FolderSheetMode = { type: 'manage' } | { type: 'sort' } | { type: 'move'; chatId: string; folderId: string | null };

export function FolderSheet({ mode, folders, sort, onSort, onClose }: {
  mode: FolderSheetMode;
  folders: { id: string; name: string }[];
  sort: FolderSort;
  onSort: (sort: FolderSort) => void;
  onClose: () => void;
}) {
  const theme = useAppTheme();
  const addFolder = usePrototypeStore((state) => state.addFolder);
  const renameFolder = usePrototypeStore((state) => state.renameFolder);
  const deleteFolder = usePrototypeStore((state) => state.deleteFolder);
  const moveChat = usePrototypeStore((state) => state.moveChat);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; name: string } | null>(null);
  const title = editing ? editing.id ? 'Rename folder' : 'New folder' : mode.type === 'move' ? 'Move to folder' : mode.type === 'sort' ? 'Sort folders' : 'Manage folders';
  const visibleFolders = folders.filter((folder) => folder.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const button = (label: string, onPress: () => void, options?: { selected?: boolean; destructive?: boolean; disabled?: boolean }) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: options?.selected, disabled: options?.disabled }} disabled={options?.disabled} onPress={onPress} style={[styles.button, { borderColor: theme.separator, opacity: options?.disabled ? 0.4 : 1 }]}><Text style={{ color: options?.destructive ? theme.red : theme.text, fontSize: 17, flexShrink: 1 }}>{label}</Text>{options?.selected ? <Text style={{ color: theme.blue }}>✓</Text> : null}</Pressable>;
  const move = (folderId: string | null) => {
    if (mode.type !== 'move') return;
    moveChat(mode.chatId, folderId);
    onClose();
  };
  return <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}><Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{title}</Text>{button('Done', onClose)}</View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {editing ? <>
            <TextInput autoFocus accessibilityLabel="Folder name" placeholder="Folder name" placeholderTextColor={theme.secondary} value={editing.name} onChangeText={(name) => setEditing({ ...editing, name })} maxLength={120} style={[styles.input, { color: theme.text, borderColor: theme.separator }]} />
            {button('Save', () => {
              const name = editing.name.trim();
              if (!name) return;
              if (editing.id) renameFolder(editing.id, name); else addFolder(name);
              setEditing(null);
              setQuery('');
            }, { disabled: !editing.name.trim() })}
            {button('Cancel', () => setEditing(null))}
          </> : mode.type === 'sort' ? <>
            <Text style={{ color: theme.secondary }}>Folder order is saved for this account on this device.</Text>
            {(['default', 'ascending', 'descending'] as const).map((value) => <View key={value}>{button(value === 'default' ? 'Default order' : value === 'ascending' ? 'Name: A–Z' : 'Name: Z–A', () => onSort(value), { selected: sort === value })}</View>)}
          </> : <>
            <TextInput accessibilityLabel="Search folders" placeholder="Search folders" placeholderTextColor={theme.secondary} value={query} onChangeText={setQuery} style={[styles.input, { color: theme.text, borderColor: theme.separator }]} />
            {mode.type === 'manage' ? button('New folder', () => setEditing({ id: null, name: '' })) : button('No folder', () => move(null), { selected: mode.folderId === null })}
            {visibleFolders.map((folder) => <View key={folder.id}>
              {mode.type === 'move' ? button(folder.name, () => move(folder.id), { selected: mode.folderId === folder.id }) : <View style={[styles.folder, { borderColor: theme.separator }]}>
                <Text style={[styles.title, { color: theme.text }]}>{folder.name}</Text>
                {button(`Rename ${folder.name}`, () => setEditing({ id: folder.id, name: folder.name }))}
                {button(`Delete ${folder.name}`, () => Alert.alert('Delete folder?', `Delete “${folder.name}”? Its chats will be kept outside the folder.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => deleteFolder(folder.id) }]), { destructive: true })}
              </View>}
            </View>)}
            {!visibleFolders.length ? <Text style={{ color: theme.secondary }}>{query ? 'No matching folders' : 'No folders yet'}</Text> : null}
          </>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  title: { fontSize: 20, fontWeight: '600', flexShrink: 1 }, content: { padding: 20, gap: 12 },
  input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 17 },
  button: { minHeight: 48, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  folder: { borderWidth: 1, borderRadius: 12, padding: 12 },
});
