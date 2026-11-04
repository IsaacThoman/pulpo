import { baseKeymap, chainCommands, createParagraphNear, liftEmptyBlock, newlineInCode, splitBlockKeepMarks } from '@tiptap/pm/commands'
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
import { parseFragment, parseXmlDocument, type XmlElement } from '../xml.js'

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

export class InlineTextEditor {
  readonly view: EditorView
  private style: TextEditorStyle

  constructor(private readonly options: InlineTextEditorOptions) {
    this.style = options.style
    const plugins = [
      ySyncPlugin(options.fragment),
      ...(options.awareness ? [yCursorPlugin(options.awareness, {}, 'pptxCursor')] : []),
      keymap({
        'Mod-z': () => (options.onUndo(), true),
        'Mod-y': () => (options.onRedo(), true),
        'Shift-Mod-z': () => (options.onRedo(), true),
        'Mod-b': () => (options.onToggleMark?.('b'), true),
        'Mod-i': () => (options.onToggleMark?.('i'), true),
        'Mod-u': () => (options.onToggleMark?.('u'), true),
        'Shift-Enter': insertLineBreak,
        Enter: chainCommands(newlineInCode, createParagraphNear, liftEmptyBlock, splitBlockKeepMarks),
        Tab: listLevel(1),
        'Shift-Tab': listLevel(-1),
        Escape: () => (options.onEscape?.(), true),
      }),
      keymap(baseKeymap),
    ]
    const state = EditorState.create({ schema: slideTextSchema(), plugins })
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const editor = this
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
        // y-tiptap dispatches while the view is still being constructed, before `this.view` is set.
        dispatchTransaction(this: EditorView, transaction) {
          const next = this.state.apply(transaction)
          this.updateState(next)
          if (transaction.docChanged && transaction.getMeta(ySyncPluginKey) === undefined) editor.refreshNumbers()
          options.onSelectionChange?.(next)
        },
      },
    )
  }

  /** Restyles after the shape's inherited formatting changed (layout, theme, list style). */
  setStyle(style: TextEditorStyle): void {
    this.style = style
    this.view.setProps({ nodeViews: this.nodeViews(), markViews: this.markViews() })
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
    const editor = this
    return {
      paragraph: (node, view, getPos) => {
        const dom = document.createElement('div')
        dom.className = 'pp-p'
        const contentDOM = document.createElement('span')
        const render = (current: ProseMirrorNode) => {
          const style = styleOfParagraph(current, editorStyle())
          dom.setAttribute('style', style.css)
          dom.replaceChildren()
          if (style.bullet) {
            const bullet = document.createElement('span')
            bullet.className = 'pp-bullet'
            bullet.contentEditable = 'false'
            bullet.setAttribute('style', style.bullet.css)
            if (style.bullet.kind === 'char') bullet.textContent = style.bullet.char
            else if (style.bullet.kind === 'number') {
              const position = getPos()
              const index = position === undefined ? 0 : view.state.doc.resolve(position).index(0)
              bullet.dataset.numberLabel = String(index)
              const styles: ParagraphStyle[] = []
              view.state.doc.forEach((child) => styles.push(styleOfParagraph(child, editorStyle())))
              bullet.textContent = autoNumberLabel(style.bullet.scheme, autoNumbers(styles)[index] ?? style.bullet.startAt)
            } else bullet.textContent = '•'
            dom.appendChild(bullet)
          }
          dom.appendChild(contentDOM)
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
          ignoreMutation: (mutation) => mutation.type === 'attributes' && mutation.target === dom,
        }
      },
      field: (node) => {
        const dom = document.createElement('span')
        dom.className = 'pp-field'
        dom.contentEditable = 'false'
        const element = parsed(`<a:fld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" type="${String(node.attrs.fieldType ?? '').replace(/[^\w]/g, '')}"><a:t>${String(node.attrs.text ?? '').replace(/[<&]/g, '')}</a:t></a:fld>`)
        dom.textContent = element && editor.style.env ? fieldText(element, editor.style.env) : String(node.attrs.text ?? '')
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

const insertLineBreak: PmCommand = (state, dispatch) => {
  const br = slideTextSchema().nodes.br!
  dispatch?.(state.tr.replaceSelectionWith(br.create()).scrollIntoView())
  return true
}

/** Tab changes the list level of selected paragraphs (PowerPoint's demote/promote). */
function listLevel(delta: number): PmCommand {
  return (state, dispatch) => paragraphCommand(paragraphEdits.level(delta))(state, dispatch)
}
