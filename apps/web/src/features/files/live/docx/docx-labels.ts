import type { DocxLabels } from '@pulpo/client-core/office/docx/view'
import { ui } from '@/i18n/ui'

/** The editor core's own text, translated. */
export function docxLabels(): DocxLabels {
  return {
    header: ui("Header"),
    firstPageHeader: ui("First page header"),
    evenPageHeader: ui("Even page header"),
    oddPageHeader: ui("Odd page header"),
    footer: ui("Footer"),
    firstPageFooter: ui("First page footer"),
    evenPageFooter: ui("Even page footer"),
    oddPageFooter: ui("Odd page footer"),
    unsupportedImage: ui("Picture in a format browsers cannot show"),
    chart: ui("Chart"),
    shape: ui("Shape"),
    embeddedObject: ui("Embedded object"),
    embeddedContent: ui("Embedded content"),
    equation: ui("Equation"),
    image: ui("Picture"),
    footnotes: ui("Footnotes"),
    endnotes: ui("Endnotes"),
    editStoryHint: ui("Double-click to edit"),
    unknownAuthor: ui("Unknown author"),
    pageOfPages: ui("Page {page} of {pages}"),
  }
}
