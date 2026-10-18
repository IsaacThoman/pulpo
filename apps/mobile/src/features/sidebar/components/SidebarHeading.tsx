import { Button as SwiftUIButton, Divider as SwiftUIDivider, Host as SwiftUIHost, Image as SwiftUIImage, Menu as SwiftUIMenu, Picker, Section, Text as SwiftUIText } from '@expo/ui/swift-ui'
import { accessibilityLabel, frame, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers'
import * as Haptics from 'expo-haptics'
import { Platform, Pressable, type StyleProp, StyleSheet, Text, type TextStyle, View } from 'react-native'
import { MaterialMenu, type Action } from '../../../platform/MaterialUI'
import { SymbolView } from '../../../platform/SymbolView'
import { useAppTheme } from '../../../theme'

export type SidebarOrder = 'default' | 'recent'
type UploadSource = 'photos' | 'camera' | 'files'

interface Props {
  title: string
  titleStyle: StyleProp<TextStyle>
  order: SidebarOrder
  /** Files on: new documents, uploads, and opening the Chats folder in Files. */
  filesEnabled: boolean
  /** Until the sidebar loads (or on servers without it) there is nowhere to create things yet. */
  canCreate: boolean
  onNewFolder: () => void
  onNewDocument: () => void
  onUpload: (source: UploadSource) => void
  onOrderChange: (order: SidebarOrder) => void
  onOpenInFiles: () => void
}

const ORDERS: ReadonlyArray<{ value: SidebarOrder; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'recent', label: 'Recent' },
]

/**
 * The heading above the drawer's chats, as on the web: a New Folder button, and a menu with what
 * the web offers on the sidebar's empty space (new document, upload, sort order, open in Files).
 */
export function SidebarHeading({ title, titleStyle, order, filesEnabled, canCreate, onNewFolder, onNewDocument, onUpload, onOrderChange, onOpenInFiles }: Props) {
  const theme = useAppTheme()
  const creates = canCreate && filesEnabled
  const setOrder = (next: string) => {
    if (next !== 'default' && next !== 'recent') return
    Haptics.selectionAsync()
    onOrderChange(next)
  }
  const newFolder = canCreate ? (
    <Pressable
      accessibilityLabel="New folder"
      accessibilityRole="button"
      hitSlop={10}
      onPress={() => { Haptics.selectionAsync(); onNewFolder() }}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      testID="sidebar-new-folder"
    >
      <SymbolView name="folder.badge.plus" size={16} tintColor={theme.secondary} />
    </Pressable>
  ) : null
  if (Platform.OS === 'ios') {
    return (
      <View style={styles.row}>
        <Text accessibilityRole="header" style={[titleStyle, styles.title]}>{title}</Text>
        {newFolder}
        <SwiftUIHost matchContents style={styles.menuHost}>
          <SwiftUIMenu
            label={<SwiftUIImage systemName="ellipsis.circle" size={16} color={theme.secondary} modifiers={[frame({ width: 28, height: 28 })]} />}
            modifiers={[accessibilityLabel('Chat list options')]}
          >
            {creates ? <SwiftUIButton label="New Document" systemImage="doc.badge.plus" onPress={onNewDocument} /> : null}
            {creates ? (
              <SwiftUIMenu label="Upload" systemImage="square.and.arrow.up">
                <SwiftUIButton label="Photo Library" systemImage="photo.on.rectangle" onPress={() => onUpload('photos')} />
                <SwiftUIButton label="Take Photo or Video" systemImage="camera" onPress={() => onUpload('camera')} />
                <SwiftUIButton label="Choose Files" systemImage="folder" onPress={() => onUpload('files')} />
              </SwiftUIMenu>
            ) : null}
            {creates ? <SwiftUIDivider /> : null}
            <Section title="Sort By">
              <Picker label="Sort By" selection={order} onSelectionChange={setOrder} modifiers={[pickerStyle('inline')]}>
                {ORDERS.map((option) => <SwiftUIText key={option.value} modifiers={[tag(option.value)]}>{option.label}</SwiftUIText>)}
              </Picker>
            </Section>
            {creates ? <SwiftUIDivider /> : null}
            {creates ? <SwiftUIButton label="Open in Files" systemImage="folder" onPress={onOpenInFiles} /> : null}
          </SwiftUIMenu>
        </SwiftUIHost>
      </View>
    )
  }
  const sections: Array<{ id: string; title?: string; actions: Action[] }> = []
  if (creates) {
    sections.push({ id: 'create', actions: [
      { label: 'New document', icon: 'doc.badge.plus', onPress: onNewDocument },
      { label: 'Upload', icon: 'square.and.arrow.up', onPress: () => undefined, submenu: { title: 'Upload', actions: [
        { label: 'Photo library', icon: 'photo.on.rectangle', onPress: () => onUpload('photos') },
        { label: 'Take photo or video', icon: 'camera', onPress: () => onUpload('camera') },
        { label: 'Choose files', icon: 'folder', onPress: () => onUpload('files') },
      ] } },
    ] })
  }
  sections.push({ id: 'order', title: 'Sort by', actions: ORDERS.map((option) => ({ label: option.label, selected: order === option.value, onPress: () => setOrder(option.value) })) })
  if (creates) sections.push({ id: 'files', actions: [{ label: 'Open in Files', icon: 'folder', onPress: onOpenInFiles }] })
  return (
    <View style={styles.row}>
      <Text accessibilityRole="header" style={[titleStyle, styles.title]}>{title}</Text>
      {newFolder}
      <MaterialMenu label="Chat list options" icon="ellipsis" compact sections={sections} />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 0, marginLeft: 12, marginRight: 6, minHeight: 32 },
  title: { flex: 1, marginTop: 0, marginBottom: 0, marginHorizontal: 0 },
  button: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  pressed: { opacity: 0.5 },
  menuHost: { width: 28, height: 28 },
})
