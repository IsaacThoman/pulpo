import { MAX_MESSAGE_FILE_REFERENCES, type FileNode, type FileReference } from '@pulpo/contracts'
import * as Haptics from 'expo-haptics'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useAppTheme } from '../../../theme'
import { useFileReferencePicker } from '../scopePicker'
import { FolderPickerSheet } from './FolderPickerSheet'

interface Props {
  namespace: string
  /** The draft's references, as composerReferences reads them from its text. */
  references: readonly FileReference[]
  /** Whether this chat can take Files at all: Files on, not a temporary chat. */
  available: boolean
  /** Whether the agent will see these items: agent mode on with a model that has it. */
  agentActive: boolean
  canUseAgent: boolean
  onTurnOnAgent: () => void
  onAdd: (references: FileReference[]) => void
}

/**
 * Adding Files items to the message being written, and what they need. The draft keeps them as its
 * last paragraph of links (sending one lets the agent work with that item in the chat); the
 * composer's attachment strip shows them as cards (see FileReferenceCard). This adds picked items
 * and, while agent mode is off, says the agent can't use them yet.
 */
export function FileReferenceBar({ namespace, references, available, agentActive, canUseAgent, onTurnOnAgent, onAdd }: Props) {
  const theme = useAppTheme()
  const picker = useFileReferencePicker()

  const add = (items: Array<{ id: string; name: string; kind: FileNode['kind'] }>, folder: { id: string | null; name: string }) => {
    picker.hide()
    const added: FileReference[] = items.length
      ? items.map((item) => ({ id: item.id, name: item.name, folder: item.kind === 'folder' }))
      // Nothing picked inside a folder adds that folder; My files as a whole is not offered.
      : folder.id ? [{ id: folder.id, name: folder.name, folder: true }] : []
    if (!added.length) return
    onAdd(added)
    // The agent reaches Files from its workspace, so mentioning items turns agent mode on.
    if (!agentActive && canUseAgent) onTurnOnAgent()
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }

  const showHint = references.length > 0 && !agentActive
  if (!available || (!showHint && !picker.open)) return null
  return (
    <View style={styles.root}>
      {showHint ? (
        <Pressable accessibilityRole="button" disabled={!canUseAgent} onPress={onTurnOnAgent} style={styles.hint}>
          <Text style={[styles.hintText, { color: theme.orange }]}>
            {canUseAgent ? 'Turn on agent mode so the agent can use these files.' : 'Choose an agent-capable model to use these files.'}
          </Text>
        </Pressable>
      ) : null}
      {picker.open ? (
        <FolderPickerSheet
          namespace={namespace}
          mode="items"
          title="Add from Files"
          confirmLabel="Add"
          limit={MAX_MESSAGE_FILE_REFERENCES}
          limitMessage={`A message can mention up to ${MAX_MESSAGE_FILE_REFERENCES} items.`}
          pickedIds={references.map((reference) => reference.id)}
          onCancel={picker.hide}
          onConfirm={add}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: 4, marginBottom: 6 },
  hint: { paddingHorizontal: 4 },
  hintText: { fontSize: 12 },
})
