import { baseKeymap, chainCommands, createParagraphNear, liftEmptyBlock, newlineInCode, splitBlockAs } from '@tiptap/pm/commands'
import { keymap } from '@tiptap/pm/keymap'
import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState, TextSelection, type Command as PmCommand } from '@tiptap/pm/state'
import { EditorView, type MarkViewConstructor, type NodeViewConstructor } from '@tiptap/pm/view'
import { yCursorPlugin, ySyncPlugin, ySyncPluginKey } from '@tiptap/y-tiptap'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { paragraphEdits, paragraphCommand } from '../formatting.js'
import type { RenderEnv } from '../render/env.js'
import { emptyBag, mergeInto } from '../render/props.js'
import { autoNumberLabel, autoNumbers, fieldText, paragraphStyle, runCss, type BodyLayout, type ParagraphStyle, type TextStyleContext } from '../render/text.js'
import { buildRunProperties, slideTextSchema, type TextJSON } from '../text.js'
import { parseFragment, parseXmlDocument, serializeNode, type XmlElement } from '../xml.js'

/**
 * The inline text editor: a ProseMirror view bound to one text body's Y.XmlFragment. Paragraph
 * and mark views draw with the renderer's own style functions, so text looks the same while it is
 * edited as when it is drawn on the slide.
 */

export interface TextEditorStyle {
  context: TextStyleContext
  body: BodyLayout
  /** For computed fields (slide number, date); without it fields show their saved text. */
  env?: RenderEnv
}

export interface InlineTextEditorOptions {
  mount: HTMLElement
  fragment: Y.XmlFragment
  awareness?: Awareness
  style: TextEditorStyle
  readOnly?: boolean
  placeholder?: string
  onUndo(): void
  onRedo(): void
  onEscape?(): void
  /** Called after every local change, with the editor state, for toolbar updates. */
  onSelectionChange?(state: EditorState): void
  /** Ctrl/Cmd shortcuts the editor does not handle itself (copy shapes, save, …). */
  onKey?(event: KeyboardEvent): boolean
  /** Tab and Shift+Tab; return true when handled (a table cell moves to the next cell). Else they change the list level. */
  onTab?(backward: boolean): boolean
  /** Bold, italic, and underline shortcuts; the host knows the inherited formatting to toggle against. */
  onToggleMark?(mark: 'b' | 'i' | 'u'): void
}

const scratch = parseXmlDocument('<w/>')

function parsed(xml: unknown): XmlElement | undefined {
  if (typeof xml !== 'string' || !xml) return undefined
  try {
    return parseFragment(xml)
  } catch {
    return undefined
  }
}

/** CSS of a single mark, through the same run CSS the renderer uses. */
export function markCss(mark: Mark, context: TextStyleContext): string {
  if (mark.type.name === 'link') {
    const link = parsed(mark.attrs.xml)
    const bag = emptyBag()
    if (link) bag.children.hlinkClick = link
    return runCss(bag, context, { hyperlink: true })
  }
  const rPr = buildRunProperties(scratch, [{ type: mark.type.name, attrs: mark.attrs }])
  return rPr ? runCss(mergeInto(emptyBag(), rPr), context) : ''
}

function styleOfParagraph(node: ProseMirrorNode, style: TextEditorStyle): ParagraphStyle {
  const first = node.firstChild
  const firstRun = first?.isText ? buildRunProperties(scratch, first.marks.map((mark) => ({ type: mark.type.name, attrs: mark.attrs }))) : undefined
  return paragraphStyle(parsed(node.attrs.pPr), style.context, style.body, firstRun)
}

// -------------------------------------------------------------------------------------------
// Collaborators' carets. Awareness comes from other clients, so every field is checked before
// y-tiptap reads it: a malformed cursor would throw on each awareness change, and a color is put
// in a style attribute.

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

function isRelativePosition(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Shows only other clients whose cursor is two relative positions. */
export function validCursorState(localClientId: number, clientId: number, state: unknown): boolean {
  if (localClientId === clientId || typeof state !== 'object' || state === null) return false
  const cursor = (state as { cursor?: unknown }).cursor
  if (cursor == null) return false
  return typeof cursor === 'object' && isRelativePosition((cursor as { anchor?: unknown }).anchor) && isRelativePosition((cursor as { head?: unknown }).head)
}

function safeColor(user: { color?: unknown }): string {
  return typeof user.color === 'string' && HEX_COLOR.test(user.color) ? user.color : '#888888'
}

export function remoteCaret(user: { name?: unknown; color?: unknown }): HTMLElement {
  const color = safeColor(user)
  const caret = document.createElement('span')
  caret.className = 'ProseMirror-yjs-cursor pp-remote-caret'
  caret.style.borderColor = color
  const label = document.createElement('div')
  label.style.backgroundColor = color
  label.textContent = typeof user.name === 'string' ? user.name.slice(0, 80) : ''
  caret.append('\u2060', label, '\u2060')
  return caret
}

export function remoteSelection(user: { color?: unknown }): { style: string; class: string } {
  return { style: `background-color: ${safeColor(user)}40`, class: 'ProseMirror-yjs-selection' }
}

/** What a style looks like, to tell whether a refresh changes anything. `env` only feeds fields. */
function styleKey(style: TextEditorStyle): string {
  return JSON.stringify({ context: style.context, body: style.body }, (_key, value: unknown) =>
    value && typeof value === 'object' && 'nodeType' in value && 'ownerDocument' in value ? serializeNode(value as XmlElement) : value,
  )
}

export class InlineTextEditor {
  readonly view: EditorView
  private style: TextEditorStyle

  constructor(private readonly options: InlineTextEditorOptions) {
    this.style = options.style
    this.styleKey = styleKey(options.style)
    const plugins = [
      ySyncPlugin(options.fragment),
      ...(options.awareness ? [yCursorPlugin(options.awareness, { awarenessStateFilter: validCursorState, cursorBuilder: remoteCaret, selectionBuilder: remoteSelection })] : []),
      keymap({
        'Mod-z': () => (options.onUndo(), true),
        'Mod-y': () => (options.onRedo(), true),
        'Shift-Mod-z': () => (options.onRedo(), true),
        'Mod-b': () => (options.onToggleMark?.('b'), true),
        'Mod-i': () => (options.onToggleMark?.('i'), true),
        'Mod-u': () => (options.onToggleMark?.('u'), true),
        'Shift-Enter': insertLineBreak,
        Enter: chainCommands(newlineInCode, createParagraphNear, liftEmptyBlock, splitParagraph),
        Tab: (state, dispatch) => options.onTab?.(false) || listLevel(1)(state, dispatch),
        'Shift-Tab': (state, dispatch) => options.onTab?.(true) || listLevel(-1)(state, dispatch),
        Escape: () => (options.onEscape?.(), true),
      }),
      keymap(baseKeymap),
    ]
    const state = EditorState.create({ schema: slideTextSchema(), plugins })
    const refreshNumbers = () => this.refreshNumbers()
    // A child of the host, not the host itself: ProseMirror takes over the element it mounts on.
    const dom = document.createElement('div')
    options.mount.append(dom)
    this.view = new EditorView(
      { mount: dom },
      {
        state,
        editable: () => !options.readOnly,
        nodeViews: this.nodeViews(),
        markViews: this.markViews(),
        attributes: { class: 'pp-text-editor', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true' },
        handleKeyDown: (_view, event) => options.onKey?.(event) ?? false,
        handleDOMEvents: {
          // ProseMirror finishes its own composition handling first.
          compositionend: () => (setTimeout(() => this.applyPendingStyle(), 0), false),
        },
        // y-tiptap dispatches while the view is still being constructed, before `this.view` is set.
        dispatchTransaction(this: EditorView, transaction) {
          // y-tiptap flushes deferred updates on a timer, which can land after the editor closed.
          if (this.isDestroyed) return
          if (options.readOnly && transaction.docChanged && transaction.getMeta(ySyncPluginKey) === undefined) return
          const next = this.state.apply(transaction)
          this.updateState(next)
          if (transaction.docChanged && transaction.getMeta(ySyncPluginKey) === undefined) refreshNumbers()
          options.onSelectionChange?.(next)
        },
      },
    )
  }

  setReadOnly(readOnly: boolean): void {
    if (Boolean(this.options.readOnly) === readOnly) return
    this.options.readOnly = readOnly
    this.view.setProps({})
  }

  /**
   * Restyles after the shape's inherited formatting changed (layout, theme, list style). Redrawing
   * replaces every paragraph's DOM, so it happens only when the style really differs, and never
   * during an IME composition, which a redraw would break: it waits for the composition to end.
   */
  setStyle(style: TextEditorStyle): void {
    const key = styleKey(style)
    if (key === this.styleKey) {
      this.style = style
      return
    }
    if (this.view.composing) {
      this.pendingStyle = style
      return
    }
    this.style = style
    this.styleKey = key
    this.view.setProps({ nodeViews: this.nodeViews(), markViews: this.markViews() })
  }

  private styleKey = ''
  private pendingStyle?: TextEditorStyle

  private applyPendingStyle(): void {
    const pending = this.pendingStyle
    this.pendingStyle = undefined
    if (pending && !this.view.isDestroyed) this.setStyle(pending)
  }

  focus(atEnd = true): void {
    this.view.focus()
    if (atEnd) this.view.dispatch(this.view.state.tr.setSelection(TextSelection.atEnd(this.view.state.doc)))
  }

  selectAll(): void {
    const { doc } = this.view.state
    this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(doc, 1, Math.max(1, doc.content.size - 1))))
  }

  run(command: PmCommand): void {
    if (this.options.readOnly) return
    command(this.view.state, this.view.dispatch, this.view)
    this.view.focus()
  }

  json(): TextJSON {
    return this.view.state.doc.toJSON() as TextJSON
  }

  destroy(): void {
    this.view.destroy()
    this.view.dom.remove()
  }

  /** Auto-numbered paragraphs depend on their neighbors, so number labels refresh after edits. */
  refreshNumbers(): void {
    const labels = this.view.dom.querySelectorAll<HTMLElement>('[data-number-label]')
    if (!labels.length) return
    const styles: ParagraphStyle[] = []
    this.view.state.doc.forEach((node) => styles.push(styleOfParagraph(node, this.style)))
    const numbers = autoNumbers(styles)
    labels.forEach((label) => {
      const index = Number(label.dataset.numberLabel)
      const style = styles[index]
      if (style?.bullet?.kind === 'number') label.textContent = autoNumberLabel(style.bullet.scheme, numbers[index] ?? style.bullet.startAt)
    })
  }

  private nodeViews(): Record<string, NodeViewConstructor> {
    const editorStyle = () => this.style
    return {
      paragraph: (node, view, getPos) => {
        const dom = document.createElement('div')
        dom.className = 'pp-p'
        const contentDOM = document.createElement('span')
        let bullet: HTMLSpanElement | undefined
        dom.appendChild(contentDOM)
        // Updates touch only the bullet and the paragraph's style: moving contentDOM would make
        // ProseMirror re-read the DOM mid-update.
        const render = (current: ProseMirrorNode) => {
          const style = styleOfParagraph(current, editorStyle())
          dom.setAttribute('style', style.css)
          if (!style.bullet) {
            bullet?.remove()
            bullet = undefined
            return
          }
          if (!bullet) {
            bullet = document.createElement('span')
            bullet.className = 'pp-bullet'
            bullet.contentEditable = 'false'
            dom.insertBefore(bullet, contentDOM)
          }
          bullet.setAttribute('style', style.bullet.css)
          delete bullet.dataset.numberLabel
          if (style.bullet.kind === 'char') bullet.textContent = style.bullet.char
          else if (style.bullet.kind === 'number') {
            const position = getPos()
            const index = position === undefined ? 0 : view.state.doc.resolve(position).index(0)
            bullet.dataset.numberLabel = String(index)
            const styles: ParagraphStyle[] = []
            view.state.doc.forEach((child) => styles.push(styleOfParagraph(child, editorStyle())))
            bullet.textContent = autoNumberLabel(style.bullet.scheme, autoNumbers(styles)[index] ?? style.bullet.startAt)
          } else bullet.textContent = '•'
        }
        render(node)
        return {
          dom,
          contentDOM,
          update(next) {
            if (next.type.name !== 'paragraph') return false
            render(next)
            return true
          },
          ignoreMutation: (mutation) => (mutation.type === 'attributes' && mutation.target === dom) || (bullet !== undefined && (mutation.target === bullet || bullet.contains(mutation.target as globalThis.Node)) ) || (mutation.type === 'childList' && mutation.target === dom),
        }
      },
      field: (node) => {
        const dom = document.createElement('span')
        dom.className = 'pp-field'
        dom.contentEditable = 'false'
        const element = parsed(`<a:fld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" type="${String(node.attrs.fieldType ?? '').replace(/[^\w]/g, '')}"><a:t>${String(node.attrs.text ?? '').replace(/[<&]/g, '')}</a:t></a:fld>`)
        dom.textContent = element && editorStyle().env ? fieldText(element, editorStyle().env!) : String(node.attrs.text ?? '')
        return { dom }
      },
      opaque: (node) => {
        const dom = document.createElement('span')
        dom.className = 'pp-opaque'
        dom.contentEditable = 'false'
        dom.textContent = String(node.attrs.text ?? '')
        return { dom }
      },
    }
  }

  private markViews(): Record<string, MarkViewConstructor> {
    const views: Record<string, MarkViewConstructor> = {}
    for (const name of Object.keys(slideTextSchema().marks)) {
      views[name] = (mark) => {
        const dom = document.createElement('span')
        const css = markCss(mark, this.style.context)
        if (css) dom.setAttribute('style', css)
        return { dom }
      }
    }
    return views
  }
}

/**
 * Enter: the new paragraph keeps the paragraph's properties (list level, bullets, alignment,
 * spacing) and the formatting at the cursor, as in PowerPoint.
 */
export const splitParagraph: PmCommand = (state, dispatch, view) => {
  const marks = state.storedMarks ?? state.selection.$from.marks()
  return splitBlockAs((node) => ({ type: node.type, attrs: node.attrs }))(
    state,
    dispatch && ((transaction) => dispatch(marks.length ? transaction.ensureMarks(marks) : transaction)),
    view,
  )
}

const insertLineBreak: PmCommand = (state, dispatch) => {
  const br = slideTextSchema().nodes.br!
  dispatch?.(state.tr.replaceSelectionWith(br.create()).scrollIntoView())
  return true
}

/** Tab changes the list level of selected paragraphs (PowerPoint's demote/promote). */
function listLevel(delta: number): PmCommand {
  return (state, dispatch) => paragraphCommand(paragraphEdits.level(delta))(state, dispatch)
}
