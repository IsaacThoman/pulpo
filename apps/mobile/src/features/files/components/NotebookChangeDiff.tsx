import type { FileChangeSummary } from '@pulpo/contracts'
import { diffNotebookFiles, type NotebookCellChange, type NotebookCellSummary, type NotebookDiff } from '@pulpo/client-core/office/notebook'
import { useQuery } from '@tanstack/react-query'
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native'
import { useAppTheme } from '../../../theme'
import { fetchChangeContent } from '../api'
import { filesErrorMessage } from '../display'

function typeLabel(type: NotebookCellSummary['type']): string {
  return type === 'code' ? 'Code' : type === 'markdown' ? 'Markdown' : 'Raw'
}

function kindLabel(change: Exclude<NotebookCellChange, { kind: 'unchanged' }>): string {
  if (change.kind === 'added') return 'Added'
  if (change.kind === 'removed') return 'Removed'
  if (change.attachmentsChanged) return 'Attachments changed'
  if (change.kind === 'moved') return change.outputsChanged ? 'Moved, outputs changed' : 'Moved'
  if (change.sourceChanged || change.typeChanged) return change.moved ? 'Moved and edited' : 'Edited'
  return 'Outputs changed'
}

function plural(count: number, one: string, many: string): string | null {
  return count ? `${count} ${count === 1 ? one : many}` : null
}

function summary(diff: NotebookDiff): string {
  const parts = [
    plural(diff.counts.added, 'cell added', 'cells added'),
    plural(diff.counts.removed, 'cell removed', 'cells removed'),
    plural(diff.counts.changed, 'cell edited', 'cells edited'),
    plural(diff.counts.moved, 'cell moved', 'cells moved'),
    plural(diff.counts.outputs, 'cell with new outputs', 'cells with new outputs'),
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'The two versions are the same.'
}

function Lines({ text, tone }: { text: string; tone: 'added' | 'removed' | 'same' }) {
  const theme = useAppTheme()
  return <>{text.replace(/\n$/, '').split('\n').map((line, index) => (
    <Text key={index} style={[styles.line, { color: tone === 'same' ? theme.secondary : theme.text, backgroundColor: tone === 'added' ? 'rgba(52,199,89,0.16)' : tone === 'removed' ? 'rgba(255,59,48,0.14)' : 'transparent' }]}>
      {tone === 'added' ? '+ ' : tone === 'removed' ? '− ' : '  '}{line || ' '}
    </Text>
  ))}</>
}

function outputsLine(cell: NotebookCellSummary | null): string {
  if (!cell?.outputs.length) return 'none'
  return cell.outputs.map((output) => (output.text ? `${output.kind}: ${output.text}` : output.kind)).join('; ')
}

function CellCard({ change, index }: { change: Exclude<NotebookCellChange, { kind: 'unchanged' }>; index: number }) {
  const theme = useAppTheme()
  const cell = change.kind === 'removed' ? change.before : change.after
  const accent = change.kind === 'added' ? theme.green : change.kind === 'removed' ? theme.red : theme.orange
  const before = change.kind === 'added' ? null : change.before
  const after = change.kind === 'removed' ? null : change.after
  const outputsChanged = before && after ? outputsLine(before) !== outputsLine(after) : Boolean((before ?? after)?.outputs.length)
  return (
    <View style={[styles.card, { borderColor: theme.separator, borderLeftColor: accent }]} testID={`notebook-diff-${change.kind}`}>
      <Text style={[styles.cardTitle, { color: theme.text }]}>
        {kindLabel(change)}<Text style={{ color: theme.secondary, fontWeight: '400' }}>{`  Cell ${index + 1} · ${typeLabel(cell.type)}`}</Text>
      </Text>
      {change.kind === 'added' ? <Lines text={change.after.source} tone="added" />
        : change.kind === 'removed' ? <Lines text={change.before.source} tone="removed" />
          : change.source ? change.source.map((row, rowIndex) => row.kind === 'gap'
            ? <Text key={rowIndex} style={[styles.gap, { color: theme.tertiary }]}>{row.count} unchanged {row.count === 1 ? 'line' : 'lines'}</Text>
            : <Lines key={rowIndex} text={row.text} tone={row.kind} />)
            : <Lines text={change.after.source} tone="same" />}
      {outputsChanged ? (
        <Text style={[styles.outputs, { color: theme.secondary }]} numberOfLines={4}>
          {before && after ? `Outputs: ${outputsLine(before)} → ${outputsLine(after)}` : `Outputs: ${outputsLine(before ?? after)}`}
        </Text>
      ) : null}
    </View>
  )
}

/**
 * An agent's change to a notebook, cell by cell, as the web's review shows it. `queryKey` sits
 * under the reply's Files key, so a revised proposal is fetched again.
 */
export function NotebookChangeDiff({ change, queryKey }: { change: FileChangeSummary; queryKey: readonly unknown[] }) {
  const theme = useAppTheme()
  const diff = useQuery({
    queryKey,
    queryFn: async () => diffNotebookFiles(await fetchChangeContent(change.id, 'before'), await fetchChangeContent(change.id, 'after')),
    staleTime: Infinity,
  })
  if (diff.isPending) return <ActivityIndicator color={theme.secondary} />
  if (diff.isError) return <Text style={{ color: theme.red }}>{filesErrorMessage(diff.error)}</Text>
  let position = 0
  const rows: React.ReactNode[] = []
  let unchanged = 0
  const flush = (key: string) => {
    if (!unchanged) return
    rows.push(<Text key={key} style={[styles.gap, { color: theme.tertiary }]}>{unchanged} unchanged {unchanged === 1 ? 'cell' : 'cells'}</Text>)
    unchanged = 0
  }
  diff.data.cells.forEach((item, index) => {
    if (item.kind === 'unchanged') {
      unchanged += 1
      position += 1
      return
    }
    flush(`gap-${index}`)
    rows.push(<CellCard key={index} change={item} index={position} />)
    if (item.kind !== 'removed') position += 1
  })
  flush('gap-end')
  return (
    <View style={styles.list} testID="notebook-diff">
      <Text style={[styles.summary, { color: theme.secondary }]}>{summary(diff.data)}</Text>
      {diff.data.metadata.length ? <Text style={[styles.summary, { color: theme.secondary }]}>{`Notebook settings changed: ${diff.data.metadata.join(', ')}`}</Text> : null}
      {rows}
    </View>
  )
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' })
const styles = StyleSheet.create({
  list: { gap: 10 },
  summary: { fontSize: 13 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderLeftWidth: 4, borderRadius: 12, paddingVertical: 8, gap: 2, overflow: 'hidden' },
  cardTitle: { fontSize: 13, fontWeight: '600', paddingHorizontal: 10, paddingBottom: 4 },
  line: { fontFamily: mono, fontSize: 12, lineHeight: 17, paddingHorizontal: 10 },
  gap: { fontSize: 12, paddingVertical: 2, textAlign: 'center' },
  outputs: { fontSize: 12, paddingHorizontal: 10, paddingTop: 6 },
})
