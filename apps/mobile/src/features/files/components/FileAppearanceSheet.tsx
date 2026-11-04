import type { FileColor, FileIcon, FileNode } from '@pulpo/contracts'
import * as Haptics from 'expo-haptics'
import { useState, type ReactNode } from 'react'
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MaterialDialog } from '../../../platform/MaterialUI'
import { SymbolView } from '../../../platform/SymbolView'
import { useAppTheme } from '../../../theme'
import { FILE_COLOR_LABELS, FILE_COLORS, FILE_ICON_LABELS, FILE_ICONS, offersIcon, sharedAppearance, type AppearanceChange } from '../appearance'
import { FILE_COLOR_HEX, FILE_ICON_SYMBOLS, fileIcon } from '../display'

interface Props {
  /** The files and folders being styled (see `styledNodes`). */
  nodes: readonly FileNode[]
  /** Applies one choice; each applies at once, as on the web. */
  onChange: (change: AppearanceChange) => void
  onClose: () => void
}

const CELL = 44
const GAP = 6

/** Options fill each row evenly: as many columns of at least CELL as fit. */
function cellWidth(rowWidth: number): number {
  if (!rowWidth) return CELL
  const columns = Math.max(1, Math.floor((rowWidth + GAP) / (CELL + GAP)))
  return Math.floor((rowWidth - GAP * (columns - 1)) / columns)
}

/**
 * Chooses the color and icon of one or more files and folders, as the web's appearance dialog
 * does: each choice applies at once, and Done closes it. Built-in folders keep their own icons,
 * so with one among them only the color is offered.
 */
export function FileAppearanceSheet({ nodes, onChange, onClose }: Props) {
  const theme = useAppTheme()
  const [appearance, setAppearance] = useState(() => sharedAppearance(nodes))
  const [rowWidth, setRowWidth] = useState(0)
  const width = cellWidth(rowWidth)
  const icons = offersIcon(nodes)
  const single = nodes.length === 1 ? nodes[0]! : null
  const preview = { ...nodes[0]!, color: appearance.color ?? null, icon: appearance.icon ?? null }
  const previewIcon = fileIcon(preview)
  const title = icons ? 'Color and Icon' : 'Color'
  const choose = (change: AppearanceChange) => {
    Haptics.selectionAsync()
    setAppearance((current) => ({ ...current, ...change }))
    onChange(change)
  }
  const accent = theme.blue

  const option = (key: string, label: string, chosen: boolean, onPress: () => void, glyph: ReactNode) => (
    <Pressable
      key={key}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: chosen }}
      hitSlop={2}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        { width },
        chosen && { backgroundColor: theme.fillStrong, borderColor: accent },
        pressed && { opacity: 0.6 },
      ]}
      testID={`file-appearance-${key}`}
    >
      {glyph}
    </Pressable>
  )

  const colors = (
    <View style={styles.options} onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}>
      {option('color-default', 'Default', appearance.color === null, () => choose({ color: null }), <SymbolView name="nosign" size={20} tintColor={theme.secondary} />)}
      {FILE_COLORS.map((color: FileColor) => option(
        `color-${color}`,
        FILE_COLOR_LABELS[color],
        appearance.color === color,
        () => choose({ color }),
        <View style={[styles.swatch, { backgroundColor: FILE_COLOR_HEX[color] }]} />,
      ))}
    </View>
  )
  const defaultIcon = fileIcon({ ...preview, icon: null })
  const glyphs = icons ? (
    <View style={styles.options}>
      {option('icon-default', 'Default', appearance.icon === null, () => choose({ icon: null }), <SymbolView name={defaultIcon.symbol as never} size={22} tintColor={defaultIcon.tint} />)}
      {FILE_ICONS.map((icon: FileIcon) => option(
        `icon-${icon}`,
        FILE_ICON_LABELS[icon],
        appearance.icon === icon,
        () => choose({ icon }),
        <SymbolView name={FILE_ICON_SYMBOLS[icon] as never} size={22} tintColor={appearance.color ? FILE_COLOR_HEX[appearance.color] : theme.secondary} />,
      ))}
    </View>
  ) : null

  const summary = (
    <View style={styles.summary}>
      {single ? <SymbolView name={previewIcon.symbol as never} size={34} tintColor={previewIcon.tint} /> : null}
      <View style={styles.flex}>
        <Text numberOfLines={1} style={[styles.summaryName, { color: theme.text }]}>{single ? single.name : `${nodes.length} items`}</Text>
        <Text style={[styles.summaryDetail, { color: theme.secondary }]}>{icons ? 'Choose a color and icon.' : 'Choose a color.'}</Text>
      </View>
    </View>
  )
  const body = (
    <>
      {summary}
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.secondary }]}>{Platform.OS === 'android' ? 'Color' : 'COLOR'}</Text>
      {colors}
      {glyphs ? <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.secondary }]}>{Platform.OS === 'android' ? 'Icon' : 'ICON'}</Text> : null}
      {glyphs}
    </>
  )

  if (Platform.OS === 'android') {
    // About 6 options a row: the summary, two rows of colors, and six rows of icons.
    return (
      <MaterialDialog visible title={title} onClose={onClose} contentHeight={icons ? 520 : 190}>
        <ScrollView>{body}</ScrollView>
      </MaterialDialog>
    )
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView edges={['bottom']} style={[styles.flex, { backgroundColor: theme.isDark ? theme.elevated : theme.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.separator }]}>
          <View style={styles.headerSide} />
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.headerTitle, { color: theme.text }]}>{title}</Text>
          <Pressable accessibilityRole="button" hitSlop={10} onPress={onClose} style={[styles.headerSide, styles.headerTrailing]} testID="file-appearance-done">
            <Text style={[styles.headerButton, { color: theme.blue }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.card, { backgroundColor: theme.isDark ? theme.elevated2 : theme.elevated }]}>{body}</View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  headerSide: { width: 72 },
  headerTrailing: { alignItems: 'flex-end' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  headerButton: { fontSize: 17, fontWeight: '600' },
  content: { padding: 16 },
  card: { borderRadius: 20, padding: 16 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  summaryName: { fontSize: 17, fontWeight: '600' },
  summaryDetail: { fontSize: 13, marginTop: 2 },
  sectionTitle: {
    marginTop: 18,
    marginBottom: 8,
    fontSize: Platform.OS === 'android' ? 14 : 12,
    fontWeight: Platform.OS === 'android' ? '500' : '700',
    letterSpacing: Platform.OS === 'android' ? 0 : 0.8,
  },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  option: { height: CELL, borderRadius: 12, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 26, height: 26, borderRadius: 13 },
})
