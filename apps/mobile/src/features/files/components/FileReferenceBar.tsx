import { MAX_MESSAGE_FILE_REFERENCES, type FileNode, type FileReference } from '@pulpo/contracts'
import { useQueries } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SymbolView } from '../../../platform/SymbolView'
import { useAppTheme } from '../../../theme'
import { fileIcon } from '../display'
import { fileNodeQuery } from '../queries'
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
  onRemove: (id: string) => void
  onOpen: (reference: FileReference) => void
}

/**
 * The Files items the message being written mentions, above the composer. The draft keeps them as
 * its last paragraph of links (sending one lets the agent work with that item in the chat); each
 * chip opens its item, and its button takes it out of the message.
 */
export function FileReferenceBar({ namespace, references, available, agentActive, canUseAgent, onTurnOnAgent, onAdd, onRemove, onOpen }: Props) {
  const theme = useAppTheme()
  const picker = useFileReferencePicker()
  const nodes = useQueries({
    queries: available ? references.map((reference) => ({ ...fileNodeQuery(namespace, reference.id), staleTime: 30_000, retry: false })) : [],
  })

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

  if (!available || (!references.length && !picker.open)) return null
  return (
    <View style={styles.root}>
      {references.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chips}>
          {references.map((reference, index) => {
            const query = nodes[index]
            const node = query?.data?.node
            const missing = Boolean(query?.isError) || Boolean(node?.trashedAt)
            return (
              <ReferenceChip
                key={reference.id}
                reference={reference}
                node={node}
                missing={missing}
                onOpen={() => onOpen(reference)}
                onRemove={() => {
                  Haptics.selectionAsync()
                  onRemove(reference.id)
                }}
              />
            )
          })}
        </ScrollView>
      ) : null}
      {references.length && !agentActive ? (
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

function ReferenceChip({ reference, node, missing, onOpen, onRemove }: {
  reference: FileReference
  node?: FileNode
  missing: boolean
  onOpen: () => void
  onRemove: () => void
}) {
  const theme = useAppTheme()
  const icon = node
    ? fileIcon(node)
    : { symbol: reference.folder ? 'folder.fill' : 'doc.fill', tint: reference.folder ? theme.blue : theme.secondary }
  const name = node?.name ?? reference.name
  return (
    <View style={[styles.chip, { backgroundColor: theme.fillStrong }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={missing ? `${name}, no longer available` : `Open ${name}`}
        disabled={missing}
        onPress={onOpen}
        style={({ pressed }) => [styles.chipMain, pressed && styles.pressed]}
      >
        <SymbolView name={icon.symbol as never} size={14} tintColor={missing ? theme.tertiary : icon.tint} />
        <Text numberOfLines={1} style={[styles.chipText, { color: missing ? theme.secondary : theme.text }]}>
          {missing ? `${name} (unavailable)` : name}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${name}`} hitSlop={8} onPress={onRemove} style={({ pressed }) => [styles.remove, pressed && styles.pressed]}>
        <SymbolView name="xmark" size={10} tintColor={theme.secondary} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: 4, marginBottom: 6 },
  chips: { gap: 6, paddingHorizontal: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', minHeight: 34, borderRadius: 17, maxWidth: 240 },
  chipMain: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 11, paddingRight: 4, paddingVertical: 7 },
  chipText: { flexShrink: 1, fontSize: 15 },
  remove: { paddingLeft: 4, paddingRight: 11, paddingVertical: 10 },
  pressed: { opacity: 0.6 },
  hint: { paddingHorizontal: 4 },
  hintText: { fontSize: 12 },
})
