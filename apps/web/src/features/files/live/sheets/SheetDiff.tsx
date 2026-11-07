import type { CellChange, FormatProperty, OtherChange, StructureChange, WorkbookDiff } from '@pulpo/client-core/office/sheets'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'

const FORMAT_LABELS: Record<FormatProperty, () => string> = {
  font: () => ui("Font"),
  size: () => ui("Font size"),
  bold: () => ui("Bold"),
  italic: () => ui("Italic"),
  underline: () => ui("Underline"),
  strikethrough: () => ui("Strikethrough"),
  textColor: () => ui("Text color"),
  fill: () => ui("Fill color"),
  borders: () => ui("Borders"),
  alignment: () => ui("Alignment"),
  wrap: () => ui("Wrap text"),
  numberFormat: () => ui("Number format"),
}

function structureText(change: StructureChange): string {
  const span = change.from === change.to ? change.from : `${change.from}–${change.to}`
  switch (change.kind) {
    case 'rowsInserted':
      return change.count === 1 ? uit`Row ${span} inserted` : uit`Rows ${span} inserted`
    case 'rowsDeleted':
      return change.count === 1 ? uit`Row ${span} deleted` : uit`Rows ${span} deleted`
    case 'columnsInserted':
      return change.count === 1 ? uit`Column ${span} inserted` : uit`Columns ${span} inserted`
    case 'columnsDeleted':
      return change.count === 1 ? uit`Column ${span} deleted` : uit`Columns ${span} deleted`
  }
}

function otherText(change: OtherChange): string {
  switch (change.kind) {
    case 'visibility':
      return change.after === 'visible' ? ui("Sheet shown") : ui("Sheet hidden")
    case 'merged':
      return uit`Merged ${change.range}`
    case 'unmerged':
      return uit`Unmerged ${change.range}`
    case 'frozenRows':
      return uit`Frozen rows: ${change.before} → ${change.after}`
    case 'frozenCols':
      return uit`Frozen columns: ${change.before} → ${change.after}`
    case 'conditionalFormats':
      return uit`Conditional formatting rules: ${change.before} → ${change.after}`
    case 'validations':
      return uit`Data validation rules: ${change.before} → ${change.after}`
    case 'drawings':
      return uit`Images and charts: ${change.before} → ${change.after}`
    case 'notes':
      return uit`Notes: ${change.before} → ${change.after}`
  }
}

function Value({ text, shown, tone }: { text?: string; shown?: string; tone: 'before' | 'after' }) {
  if (text === undefined) return <span className="text-muted-foreground/60">—</span>
  return (
    <span className={cn('break-all', tone === 'before' ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300')}>
      <span className="font-mono">{text}</span>
      {shown !== undefined && <span className="ml-1.5 text-muted-foreground">({shown})</span>}
    </span>
  )
}

function CellRow({ change }: { change: CellChange }) {
  const valueChanged = change.before !== change.after
  return (
    <tr className="border-t align-top">
      <th scope="row" className="px-3 py-1.5 text-left font-mono font-medium">{change.address}</th>
      <td className="px-3 py-1.5">{valueChanged || change.kind !== 'changed' ? <Value text={change.before} shown={change.beforeShown} tone="before" /> : <span className="text-muted-foreground">{change.before}</span>}</td>
      <td className="px-3 py-1.5">{valueChanged || change.kind !== 'changed' ? <Value text={change.after} shown={change.afterShown} tone="after" /> : <span className="text-muted-foreground">{ui("Same value")}</span>}</td>
      <td className="px-3 py-1.5 text-muted-foreground">
        {change.format?.map((entry) => (
          <div key={entry.property}>
            {FORMAT_LABELS[entry.property]()}: {entry.before} → {entry.after}
          </div>
        ))}
      </td>
    </tr>
  )
}

/** A proposed spreadsheet change, sheet by sheet, as a readable table. */
export function SheetDiff({ diff, className }: { diff: WorkbookDiff; className?: string }) {
  const changed = diff.sheets.filter((sheet) => sheet.status !== 'unchanged')
  return (
    <div className={cn('space-y-4 text-sm', className)} data-testid="sheet-diff">
      <p className="text-muted-foreground">
        {diff.totals.cellsChanged === 0 && changed.length === 0
          ? ui("No changes")
          : diff.totals.cellsChanged === 1
            ? ui("1 cell changes")
            : uit`${diff.totals.cellsChanged} cells change`}
        {changed.length > 1 && ` · ${uit`${changed.length} sheets`}`}
      </p>
      {changed.map((sheet) => (
        <section key={`${sheet.previousName ?? ''}|${sheet.name}`} className="overflow-hidden rounded-lg border bg-muted/30">
          <header className="flex flex-wrap items-baseline gap-2 border-b bg-muted px-3 py-2">
            <h3 className="font-medium">{sheet.name}</h3>
            {sheet.previousName && <span className="text-xs text-muted-foreground">{uit`Renamed from ${sheet.previousName}`}</span>}
            {sheet.status === 'added' && <span className="rounded bg-emerald-500/15 px-1.5 text-xs text-emerald-700 dark:text-emerald-300">{ui("New sheet")}</span>}
            {sheet.status === 'removed' && <span className="rounded bg-red-500/15 px-1.5 text-xs text-red-700 dark:text-red-300">{ui("Deleted sheet")}</span>}
          </header>
          {(sheet.structure.length > 0 || sheet.other.length > 0) && (
            <ul className="space-y-0.5 border-b px-3 py-2 text-muted-foreground">
              {sheet.structure.map((change, index) => (
                <li key={`s${index}`}>{structureText(change)}</li>
              ))}
              {sheet.other.map((change, index) => (
                <li key={`o${index}`}>{otherText(change)}</li>
              ))}
            </ul>
          )}
          {sheet.cells.length > 0 && (
            <div className="max-h-96 overflow-auto">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-1.5 font-medium">{ui("Cell")}</th>
                    <th scope="col" className="px-3 py-1.5 font-medium">{ui("Before")}</th>
                    <th scope="col" className="px-3 py-1.5 font-medium">{ui("After")}</th>
                    <th scope="col" className="px-3 py-1.5 font-medium">{ui("Formatting")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.cells.map((change) => (
                    <CellRow key={change.address} change={change} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
      {diff.names.length > 0 && (
        <section className="rounded-lg border bg-muted/30 px-3 py-2">
          <h3 className="mb-1 font-medium">{ui("Named ranges")}</h3>
          <ul className="space-y-0.5 font-mono text-xs">
            {diff.names.map((name) => (
              <li key={name.name}>
                {name.name}: <Value text={name.before} tone="before" /> → <Value text={name.after} tone="after" />
              </li>
            ))}
          </ul>
        </section>
      )}
      {diff.truncated && <p className="text-muted-foreground">{ui("Only the first changes of each sheet are listed.")}</p>}
    </div>
  )
}
