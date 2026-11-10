import { MAX_MESSAGE_FILE_REFERENCES, type FileNode, type FileReference } from '@pulpo/contracts'
import * as Haptics from 'expo-haptics'
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
 * Adding Files items to the message being written. The draft keeps them as its last paragraph of
 * links (sending one lets the agent work with that item in the chat); the composer's attachment
 * strip shows them as cards (see FileReferenceCard). Like attachments that need the agent, a draft
 * with them can't be sent until Agent mode is on (see agentModeRestriction).
 */
export function FileReferenceBar({ namespace, references, available, agentActive, canUseAgent, onTurnOnAgent, onAdd }: Props) {
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

  if (!available || !picker.open) return null
  return (
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
  )
}
