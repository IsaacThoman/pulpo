import { MAX_MESSAGE_FILE_REFERENCES, type FileNode, type FileReference } from '@pulpo/contracts'
import { applyFileMention } from '@pulpo/client-core/files'
import * as Haptics from 'expo-haptics'
import { useFileMentionSuggestions } from '../mentions'
import { useFileReferencePicker } from '../scopePicker'
import { FileMentionList } from './FileMentionList'
import { FolderPickerSheet } from './FolderPickerSheet'

/** The message field, for suggesting Files items while an `@` word is typed in it. */
export interface FileMentionInput {
  /** The field's text, without the draft's references. */
  text: string
  selection: { start: number; end: number }
  focused: boolean
  /** Puts `next.text` in the field with the caret at `next.caret`. */
  onReplaceText: (next: { text: string; caret: number }) => void
}

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
  /** Suggests items for an `@` word typed in the field; choosing one writes its name and adds it. */
  mention?: FileMentionInput
}

/**
 * Adding Files items to the message being written. The draft keeps them as its last paragraph of
 * links (sending one lets the agent work with that item in the chat); the composer's attachment
 * strip shows them as cards (see FileReferenceCard). Like attachments that need the agent, a draft
 * with them can't be sent until Agent mode is on (see agentModeRestriction). Typing `@` in the
 * field lists matching items above it too; choosing one adds it the same way the picker does.
 */
export function FileReferenceBar({ namespace, references, available, agentActive, canUseAgent, onTurnOnAgent, onAdd, mention }: Props) {
  const picker = useFileReferencePicker()

  const mentionItems = (added: FileReference[]) => {
    onAdd(added)
    // The agent reaches Files from its workspace, so mentioning items turns agent mode on.
    if (!agentActive && canUseAgent) onTurnOnAgent()
  }

  const add = (items: Array<{ id: string; name: string; kind: FileNode['kind'] }>, folder: { id: string | null; name: string }) => {
    picker.hide()
    const added: FileReference[] = items.length
      ? items.map((item) => ({ id: item.id, name: item.name, folder: item.kind === 'folder' }))
      // Nothing picked inside a folder adds that folder; My files as a whole is not offered.
      : folder.id ? [{ id: folder.id, name: folder.name, folder: true }] : []
    if (!added.length) return
    mentionItems(added)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }

  if (!available) return null
  return (
    <>
      {mention ? <FileMentionSuggestions namespace={namespace} references={references} input={mention} onMention={mentionItems} /> : null}
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
    </>
  )
}

/** The suggestions for the `@` word at the caret; choosing one writes its name there and mentions it. */
function FileMentionSuggestions({ namespace, references, input, onMention }: {
  namespace: string
  references: readonly FileReference[]
  input: FileMentionInput
  onMention: (added: FileReference[]) => void
}) {
  const { token, query, suggestions } = useFileMentionSuggestions({
    namespace, enabled: input.focused, text: input.text, selection: input.selection, references,
  })
  return (
    <FileMentionList
      query={query}
      suggestions={suggestions}
      onChoose={(suggestion) => {
        if (!token) return
        input.onReplaceText(applyFileMention(input.text, token, suggestion.node.name))
        onMention([{ id: suggestion.node.id, name: suggestion.node.name, folder: suggestion.node.kind === 'folder' }])
        Haptics.selectionAsync()
      }}
    />
  )
}
