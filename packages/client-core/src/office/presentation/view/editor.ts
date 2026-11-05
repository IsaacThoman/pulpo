import { SlideCanvas, type SlideCanvasOptions } from './canvas.js'
import { PresentationController, type PresentationViewOptions } from './controller.js'
import { NotesEditor } from './notes.js'
import { Presenter, printSlides } from './present.js'
import { ensureStyles } from './styles.js'
import { SlideList } from './thumbnails.js'

/**
 * The whole editor in one call, for hosts without their own layout (the mobile webview, tests):
 * thumbnails on the left, the canvas, and speaker notes below. Hosts that build their own chrome
 * (the web app) use the pieces directly.
 */
export interface PresentationEditorOptions extends PresentationViewOptions, SlideCanvasOptions {
  container: HTMLElement
  /** Leave out the notes pane (small screens). */
  hideNotes?: boolean
}

export interface PresentationEditor {
  controller: PresentationController
  canvas: SlideCanvas
  thumbnails: SlideList
  notes?: NotesEditor
  present(options?: { presenterView?: boolean; fromCurrent?: boolean }): Presenter
  print(): Promise<void>
  destroy(): void
}

export function mountPresentationEditor(options: PresentationEditorOptions): PresentationEditor {
  ensureStyles(options.container.ownerDocument)
  const controller = new PresentationController(options)
  const root = document.createElement('div')
  root.className = 'pp-editor'
  root.style.cssText = 'display:grid;grid-template-columns:minmax(120px,200px) 1fr;grid-template-rows:1fr auto;width:100%;height:100%;min-height:0'
  const strip = document.createElement('div')
  strip.style.cssText = 'grid-row:1/3;min-height:0;overflow:hidden;border-right:1px solid rgba(0,0,0,.1)'
  const main = document.createElement('div')
  main.style.cssText = 'min-height:0;position:relative'
  const notesPane = document.createElement('div')
  notesPane.style.cssText = 'height:120px;border-top:1px solid rgba(0,0,0,.1)'
  root.append(strip, main, ...(options.hideNotes ? [] : [notesPane]))
  options.container.append(root)
  const thumbnails = new SlideList(strip, controller, { layout: 'strip' })
  const canvas = new SlideCanvas(main, controller, options)
  const notes = options.hideNotes ? undefined : new NotesEditor(notesPane, controller)
  let presenter: Presenter | undefined
  return {
    controller,
    canvas,
    thumbnails,
    ...(notes ? { notes } : {}),
    present(presentOptions = {}) {
      presenter?.exit()
      presenter = new Presenter(controller, {
        ...(presentOptions.fromCurrent && controller.state.slide ? { startAt: controller.state.slide } : {}),
        presenterView: presentOptions.presenterView === true,
        onExit: () => {
          presenter = undefined
          canvas.focus()
        },
      })
      return presenter
    },
    print: () => printSlides(controller),
    destroy() {
      presenter?.exit()
      notes?.destroy()
      canvas.destroy()
      thumbnails.destroy()
      controller.destroy()
      root.remove()
    },
  }
}
