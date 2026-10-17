import { FILE_ACCESS_MODES, FILE_SCOPE_ROOT, type FileAccessMode, type FileNode } from '@pulpo/contracts'
import { Button as SwiftUIButton, Divider as SwiftUIDivider, HStack, Host as SwiftUIHost, Image as SwiftUIImage, Menu as SwiftUIMenu, Picker, Section, Text as SwiftUIText } from '@expo/ui/swift-ui'
import { accessibilityLabel, buttonStyle, font, foregroundStyle, lineLimit, padding, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers'
import { useQueries } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { useState } from 'react'
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { create } from 'zustand'
import { MaterialMenu } from '../../../platform/MaterialUI'
import { useAppTheme } from '../../../theme'
import { ACCESS_MODE_LABELS, MAX_CHAT_FILE_SCOPES, type ChatFileScope } from '../chatScope'
import { fileIcon } from '../display'
import { fileNodeQuery } from '../queries'
import { FolderPickerSheet } from './FolderPickerSheet'

/** Opens the "Add from Files" picker from the composer's + menu. */
export const useFileScopePicker = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}))

interface Props {
  namespace: string
  scope: ChatFileScope
  /** Whether the agent will see these items: agent mode on with a model that has it. */
  agentActive: boolean
  canUseAgent: boolean
  onTurnOnAgent: () => void
  onOpenItem: (node: FileNode) => void
}

interface Chip {
  id: string
  name: string
  node?: FileNode
  missing: boolean
  mode: FileAccessMode
}

const MODE_SYMBOL: Record<FileAccessMode, string> = { read: 'eye', suggest: 'text.badge.checkmark', write: 'pencil' }

/**
 * The Files items a chat's agent works with, above the composer: each chip names an item and how
 * the agent may use it (read, suggest, or edit), with a menu to change that, open it, or remove it.
 */
export function FileScopeBar({ namespace, scope, agentActive, canUseAgent, onTurnOnAgent, onOpenItem }: Props) {
  const theme = useAppTheme()
  const picker = useFileScopePicker()
  const nodes = useQueries({
    queries: scope.ids.filter((id) => id !== FILE_SCOPE_ROOT).map((id) => ({ ...fileNodeQuery(namespace, id), staleTime: 30_000, retry: false })),
  })
  const byId = new Map<string, { node?: FileNode; missing: boolean }>()
  scope.ids.filter((id) => id !== FILE_SCOPE_ROOT).forEach((id, index) => {
    const query = nodes[index]
    const node = query?.data?.node
    byId.set(id, { node, missing: Boolean(query?.isError) || Boolean(node?.trashedAt) })
  })
  const chips: Chip[] = scope.ids.map((id) => {
    if (id === FILE_SCOPE_ROOT) return { id, name: 'All files', missing: false, mode: scope.accessOf(id) }
    const entry = byId.get(id)
    return { id, name: entry?.node?.name ?? 'Loading…', node: entry?.node, missing: entry?.missing ?? false, mode: scope.accessOf(id) }
  })
  const [lastLimitAlert, setLastLimitAlert] = useState(0)

  const add = (items: Array<{ id: string }>, fallback: { id: string | null; name: string }) => {
    picker.hide()
    const ids = items.length ? items.map((item) => item.id) : [fallback.id ?? FILE_SCOPE_ROOT]
    const dropped = scope.add(ids)
    if (dropped && Date.now() - lastLimitAlert > 1_000) {
      setLastLimitAlert(Date.now())
      Alert.alert('That’s the limit', `A chat can work with up to ${MAX_CHAT_FILE_SCOPES} Files items.`)
    }
    // The agent reaches Files from its workspace, so adding items turns agent mode on.
    if (!agentActive && canUseAgent) onTurnOnAgent()
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }

  if (!scope.available || (!chips.length && !picker.open)) return null
  return (
    <View style={styles.root}>
      {chips.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chips}>
          {chips.map((chip) => <ScopeChip key={chip.id} chip={chip} scope={scope} onOpen={chip.node ? () => onOpenItem(chip.node!) : undefined} />)}
        </ScrollView>
      ) : null}
      {chips.length && !agentActive ? (
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
          limit={MAX_CHAT_FILE_SCOPES}
          pickedIds={scope.ids}
          onCancel={picker.hide}
          onConfirm={add}
        />
      ) : null}
    </View>
  )
}

function ScopeChip({ chip, scope, onOpen }: { chip: Chip; scope: ChatFileScope; onOpen?: () => void }) {
  const theme = useAppTheme()
  const icon = chip.id === FILE_SCOPE_ROOT ? { symbol: 'folder.fill', tint: '#0A84FF' } : chip.node ? fileIcon(chip.node) : { symbol: 'doc', tint: theme.secondary }
  const modeLabel = ACCESS_MODE_LABELS[chip.mode].title
  const label = `${chip.name}, ${modeLabel}${chip.missing ? ', no longer available' : ''}`
  const remove = () => {
    Haptics.selectionAsync()
    scope.remove(chip.id)
  }
  if (Platform.OS === 'ios') {
    return (
      <SwiftUIHost matchContents style={styles.chipHost}>
        <SwiftUIMenu
          label={(
            <HStack spacing={6} modifiers={[padding({ horizontal: 10, vertical: 6 })]}>
              <SwiftUIImage systemName={icon.symbol as never} size={13} color={icon.tint} />
              <SwiftUIText modifiers={[lineLimit(1), font({ size: 14 }), foregroundStyle(chip.missing ? 'secondary' : 'primary')]}>{chip.missing ? `${chip.name} (unavailable)` : chip.name}</SwiftUIText>
              <SwiftUIImage systemName={MODE_SYMBOL[chip.mode] as never} size={11} color={chip.mode === 'write' ? theme.orange : theme.secondary} />
            </HStack>
          )}
          modifiers={[buttonStyle('bordered'), accessibilityLabel(label)]}
        >
          {onOpen ? <SwiftUIButton label="Open" systemImage="arrow.up.forward.app" onPress={onOpen} /> : null}
          <Section title={`The agent may: ${ACCESS_MODE_LABELS[chip.mode].detail.toLowerCase()}`}>
            <Picker
              label="Access"
              selection={chip.mode}
              onSelectionChange={(mode) => { if ((FILE_ACCESS_MODES as readonly string[]).includes(mode)) scope.setAccess(chip.id, mode as FileAccessMode) }}
              modifiers={[pickerStyle('inline')]}
            >
              {FILE_ACCESS_MODES.map((mode) => (
                <SwiftUILabelRow key={mode} mode={mode} />
              ))}
            </Picker>
          </Section>
          <SwiftUIDivider />
          <SwiftUIButton label="Remove from Chat" systemImage="xmark.circle" role="destructive" onPress={remove} />
        </SwiftUIMenu>
      </SwiftUIHost>
    )
  }
  return (
    <MaterialMenu
      label={label}
      icon={MODE_SYMBOL[chip.mode]}
      text={chip.name}
      compact
      sections={[
        ...(onOpen ? [{ id: 'open', actions: [{ label: 'Open', icon: 'arrow.up.forward.app', onPress: onOpen }] }] : []),
        { id: 'access', title: 'What the agent may do', actions: FILE_ACCESS_MODES.map((mode) => ({ label: ACCESS_MODE_LABELS[mode].title, selected: chip.mode === mode, onPress: () => scope.setAccess(chip.id, mode) })) },
        { id: 'remove', actions: [{ label: 'Remove from chat', icon: 'xmark.circle', destructive: true, onPress: remove }] },
      ]}
    />
  )
}

function SwiftUILabelRow({ mode }: { mode: FileAccessMode }) {
  return <SwiftUIText modifiers={[tag(mode)]}>{ACCESS_MODE_LABELS[mode].title}</SwiftUIText>
}

const styles = StyleSheet.create({
  root: { gap: 4, marginBottom: 6 },
  chips: { gap: 6, paddingHorizontal: 2 },
  chipHost: { height: 34 },
  hint: { paddingHorizontal: 4 },
  hintText: { fontSize: 12 },
})
