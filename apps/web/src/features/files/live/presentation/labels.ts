import type { PresentationLabels } from '@pulpo/client-core/office/presentation/view'
import { ui } from '@/i18n/ui'

/** Visible text the presentation view core draws itself, translated by the app. */
export function presentationLabels(): PresentationLabels {
  return {
    titlePrompt: ui("Click to add title"),
    bodyPrompt: ui("Click to add text"),
    subtitlePrompt: ui("Click to add subtitle"),
    chartUnavailable: ui("This chart type cannot be shown"),
    mediaPlay: ui("Play media"),
    notesPlaceholder: ui("Click to add speaker notes"),
    // The view core fills in {n}; ui() leaves unknown placeholders alone.
    slideNumber: ui("Slide {n}"),
    hiddenSlide: ui("Hidden"),
    nextSlide: ui("Next slide"),
    notes: ui("Notes"),
    noNotes: ui("No notes"),
    endOfShow: ui("End of slide show. Click to exit."),
    elapsed: ui("Elapsed time"),
    shapeNames: {
      rectangle: ui("Rectangle"),
      textBox: ui("TextBox"),
      picture: ui("Picture"),
      table: ui("Table"),
      group: ui("Group"),
      shape: ui("Shape"),
    },
  }
}
