import * as Y from 'yjs'
import { ensureNotes, slideMap } from '../commands.js'
import { emptyBag } from '../render/props.js'
import { bodyLayout } from '../render/text.js'
import { LOCAL_ORIGIN, type PresentationController } from './controller.js'
import { editorShortcut } from './shortcuts.js'
import { ensureStyles } from './styles.js'
import { InlineTextEditor } from './text-editor.js'

/**
 * The speaker notes editor under the canvas: the current slide's notes text, collaborative like
 * any other text. Slides without notes get a notes page on first edit, not on first look.
 */
export class NotesEditor {
  readonly element: HTMLElement
  private editor?: InlineTextEditor
  private slide?: string
  private readonly unsubscribe: () => void

  constructor(
    container: HTMLElement,
    private readonly controller: PresentationController,
  ) {
    ensureStyles(container.ownerDocument)
    this.element = document.createElement('div')
    this.element.className = 'pp-notes'
    this.element.setAttribute('aria-label', controller.labels.notes)
    this.element.dataset.placeholder = controller.labels.notesPlaceholder
    container.append(this.element)
    this.element.addEventListener('pointerdown', this.onPointerDown)
    this.element.addEventListener('focusin', this.onFocus)
    this.unsubscribe = controller.subscribe(() => this.sync())
    this.sync()
  }

  destroy(): void {
    this.unsubscribe()
    this.release()
    this.editor?.destroy()
    this.element.remove()
  }

  /** Formatting no longer goes to an editor that is going away. */
  private release(): void {
    if (this.editor) this.controller.releaseNotesTarget(this.editor)
  }

  // Typing notes makes them the target of the toolbar's text formatting.
  private readonly onFocus = (): void => {
    if (this.editor && !this.controller.readOnly) this.controller.setNotesTarget(this.editor)
  }

  private fragment(slideKey: string): Y.XmlFragment | undefined {
    const notes = slideMap(this.controller.doc, slideKey)?.get('notes')
    const text = notes instanceof Y.Map ? notes.get('text') : undefined
    return text instanceof Y.XmlFragment ? text : undefined
  }

  private sync(): void {
    this.editor?.setReadOnly(this.controller.readOnly)
    const slide = this.controller.state.slide
    const fragment = slide ? this.fragment(slide) : undefined
    if (slide === this.slide && (this.editor ? this.editorFragment === fragment : !fragment)) {
      this.updateEmpty()
      return
    }
    this.slide = slide
    this.mount(fragment)
  }

  private editorFragment?: Y.XmlFragment

  private mount(fragment: Y.XmlFragment | undefined): void {
    this.release()
    this.editor?.destroy()
    this.editor = undefined
    this.editorFragment = fragment
    this.element.replaceChildren()
    if (!fragment) {
      this.updateEmpty()
      return
    }
    const deck = this.controller.deck()
    const run = emptyBag()
    run.attrs.sz = '1200'
    this.editor = new InlineTextEditor({
      mount: this.element,
      fragment,
      style: { context: { chain: [], baseRun: run, theme: deck.theme(undefined), colors: { scheme: deck.theme(undefined).colors, colorMap: {} } }, body: bodyLayout([]) },
      readOnly: this.controller.readOnly,
      onUndo: () => this.controller.undo(),
      onRedo: () => this.controller.redo(),
      // Notes inherit no formatting but 12 pt, so the controller toggles against the notes text.
      onToggleMark: (mark) => {
        if (!this.editor || this.controller.readOnly) return
        this.controller.setNotesTarget(this.editor)
        this.controller.toggleMark(mark)
      },
      onKey: (event) => editorShortcut(this.controller, event),
      onSelectionChange: () => {
        this.updateEmpty()
        // Toolbar state follows the notes selection while they are the target.
        if (this.editor && this.controller.notesFocused) this.controller.setState({})
      },
    })
    this.updateEmpty()
  }

  private updateEmpty(): void {
    const empty = !this.editorFragment || this.editorFragment.toString().replace(/<[^>]*>/g, '') === ''
    this.element.classList.toggle('pp-notes-empty', empty)
  }

  private readonly onPointerDown = (): void => {
    if (this.editor || this.controller.readOnly || !this.slide) return
    const fragment = ensureNotes(this.controller.doc, this.slide, LOCAL_ORIGIN)
    if (!fragment) return
    this.mount(fragment)
    requestAnimationFrame(() => this.editor?.focus())
  }
}
