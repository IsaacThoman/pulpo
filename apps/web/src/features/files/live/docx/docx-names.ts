import type { HeaderFooterKind, HeaderFooterType } from '@pulpo/client-core/office/docx/view'
import { activeLocale, ui } from '@/i18n/ui'

/** The word count the status bar shows: the selection's out of the document's, as Docs and Word do. */
export function wordCountLabel(document: number, selected: number | null): string {
  const locale = activeLocale()
  const count = document.toLocaleString(locale)
  if (selected) return ui("{{selected}} of {{count}} words", { selected: selected.toLocaleString(locale), count })
  return document === 1 ? ui("1 word") : ui("{{count}} words", { count })
}

/** What a header or footer is called, by kind and type ("First page header", "Footer"). */
export function headerFooterName(kind: HeaderFooterKind, type: HeaderFooterType, oddEven: boolean): string {
  if (kind === 'header') return type === 'first' ? ui("First page header") : type === 'even' ? ui("Even page header") : oddEven ? ui("Odd page header") : ui("Header")
  return type === 'first' ? ui("First page footer") : type === 'even' ? ui("Even page footer") : oddEven ? ui("Odd page footer") : ui("Footer")
}
