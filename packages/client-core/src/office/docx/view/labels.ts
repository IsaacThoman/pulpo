/**
 * Text the editor core draws itself. Hosts pass translated strings (the web app through `ui()`),
 * so the core never hard-codes a language. `{name}` placeholders are filled in by the core.
 */
export interface DocxLabels {
  header: string
  firstPageHeader: string
  evenPageHeader: string
  oddPageHeader: string
  footer: string
  firstPageFooter: string
  evenPageFooter: string
  oddPageFooter: string
  /** Shown on a picture that cannot be drawn in a browser (EMF, WMF, TIFF). */
  unsupportedImage: string
  chart: string
  shape: string
  embeddedObject: string
  /** An embedded chunk or other block the editor keeps but cannot show. */
  embeddedContent: string
  equation: string
  /** A picture that is still loading or missing. */
  image: string
  footnotes: string
  endnotes: string
  /** Double-click hint on headers and footers. */
  editStoryHint: string
  /** Tracked change author when the user has no name. */
  unknownAuthor: string
  /** Page numbers with the total, written into headers and footers: `{page}` and `{pages}` become fields. */
  pageOfPages: string
}

export const DEFAULT_DOCX_LABELS: DocxLabels = {
  header: 'Header',
  firstPageHeader: 'First page header',
  evenPageHeader: 'Even page header',
  oddPageHeader: 'Odd page header',
  footer: 'Footer',
  firstPageFooter: 'First page footer',
  evenPageFooter: 'Even page footer',
  oddPageFooter: 'Odd page footer',
  unsupportedImage: 'Picture in a format browsers cannot show',
  chart: 'Chart',
  shape: 'Shape',
  embeddedObject: 'Embedded object',
  embeddedContent: 'Embedded content',
  equation: 'Equation',
  image: 'Picture',
  footnotes: 'Footnotes',
  endnotes: 'Endnotes',
  editStoryHint: 'Double-click to edit',
  unknownAuthor: 'Unknown',
  pageOfPages: 'Page {page} of {pages}',
}

export function fillLabel(label: string, values: Record<string, string | number>): string {
  return label.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match))
}
