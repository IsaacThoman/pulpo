import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../theme';

export type MoveToFolderSheetProps = {
  /**
   * Where the chat or item is now: a folder, null for no folder (the top of the sidebar), or
   * undefined outside the sidebar (the top of My files), where none is checked.
   */
  folderId: string | null | undefined;
  /** The folders it can go in, outermost first, with how deeply each is nested. */
  folders: { id: string; name: string; depth?: number }[];
  /** Folders it cannot go in: an item's own folder and those inside it. */
  disabledIds?: ReadonlySet<string>;
  onMove: (folderId: string | null) => void;
  /** Browses Files for a folder elsewhere (with Files on). */
  onOther?: () => void;
  onClose: () => void;
};

export function MoveToFolderSheet({ folderId, folders, disabledIds, onMove, onOther, onClose }: MoveToFolderSheetProps) {
  const theme = useAppTheme();
  const [query, setQuery] = useState('');
  const search = query.trim().toLocaleLowerCase();
  const visibleFolders = folders.filter((folder) => folder.name.toLocaleLowerCase().includes(search));
  const button = (label: string, onPress: () => void, options: { selected?: boolean; disabled?: boolean; depth?: number } = {}) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: options.selected, disabled: options.disabled }} disabled={options.disabled} onPress={onPress} style={[styles.button, { borderColor: theme.separator, paddingLeft: 12 + (options.depth ?? 0) * 18, opacity: options.disabled ? 0.4 : 1 }]}><Text style={{ color: theme.text, fontSize: 17, flexShrink: 1 }}>{label}</Text>{options.selected ? <Text style={{ color: theme.blue }}>✓</Text> : null}</Pressable>;
  const move = (destination: string | null) => {
    onMove(destination);
    onClose();
  };
  return <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}><Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>Move to folder</Text>{button('Cancel', onClose)}</View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <TextInput accessibilityLabel="Search folders" placeholder="Search folders" placeholderTextColor={theme.secondary} value={query} onChangeText={setQuery} style={[styles.input, { color: theme.text, borderColor: theme.separator }]} />
          {button('No folder', () => move(null), { selected: folderId === null })}
          {/* A search lists the matches on their own, so nesting is left out. */}
          {visibleFolders.map((folder) => <View key={folder.id}>{button(folder.name, () => move(folder.id), { selected: folderId === folder.id, disabled: disabledIds?.has(folder.id), depth: search ? 0 : folder.depth })}</View>)}
          {!visibleFolders.length ? <Text style={{ color: theme.secondary }}>{query ? 'No matching folders' : 'No folders yet'}</Text> : null}
          {onOther ? button('Other folder…', () => { onClose(); onOther(); }) : null}
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
});
