import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePrototypeStore } from '../store/prototypeStore';
import { useAppTheme } from '../theme';

export function MoveToFolderSheet({ chatId, folderId, folders, onClose }: {
  chatId: string;
  folderId: string | null;
  folders: { id: string; name: string }[];
  onClose: () => void;
}) {
  const theme = useAppTheme();
  const moveChat = usePrototypeStore((state) => state.moveChat);
  const [query, setQuery] = useState('');
  const visibleFolders = folders.filter((folder) => folder.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const button = (label: string, onPress: () => void, selected?: boolean) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.button, { borderColor: theme.separator }]}><Text style={{ color: theme.text, fontSize: 17, flexShrink: 1 }}>{label}</Text>{selected ? <Text style={{ color: theme.blue }}>✓</Text> : null}</Pressable>;
  const move = (destination: string | null) => {
    moveChat(chatId, destination);
    onClose();
  };
  return <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}><Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>Move to folder</Text>{button('Cancel', onClose)}</View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <TextInput accessibilityLabel="Search folders" placeholder="Search folders" placeholderTextColor={theme.secondary} value={query} onChangeText={setQuery} style={[styles.input, { color: theme.text, borderColor: theme.separator }]} />
          {button('No folder', () => move(null), folderId === null)}
          {visibleFolders.map((folder) => <View key={folder.id}>{button(folder.name, () => move(folder.id), folderId === folder.id)}</View>)}
          {!visibleFolders.length ? <Text style={{ color: theme.secondary }}>{query ? 'No matching folders' : 'No folders yet'}</Text> : null}
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
