/*
 * An agent's proposed deck against the current one, on a phone: one card per changed slide with
 * before and after thumbnails, what changed on it, and text changes as a line diff. The same view
 * as the web's review, drawn with DOM APIs. Both versions are untrusted files: they go through the
 * codec's reader and limits, and slides are drawn by the shared renderer, which escapes text and
 * only puts allowlisted images in.
 */
import type { LiveAssetRef, LiveAssetStore } from '@pulpo/client-core/office'
import {
  assetObjectUrl,
  DeckResources,
  diffSnapshots,
  displayableMediaType,
  readPresentation,
  renderSlide,
  type PresentationDiff,
  type PresentationSnapshot,
  type ShapeChangeKind,
  type SlideDiff,
} from '@pulpo/client-core/office/presentation'

const STATUS: Record<SlideDiff['status'], string> = { added: 'Added', removed: 'Removed', moved: 'Moved', edited: 'Edited', unchanged: 'Unchanged' }

const SHAPE_CHANGES: Record<ShapeChangeKind, string> = {
  added: 'added',
  removed: 'removed',
  text: 'text changed',
  formatting: 'formatting changed',
  moved: 'moved',
  resized: 'resized',
  rotated: 'rotated or flipped',
  fill: 'fill changed',
  line: 'outline changed',
  geometry: 'shape changed',
  image: 'picture replaced',
  table: 'table changed',
  other: 'changed',
}

const SLIDE_CHANGES: Record<string, string> = {
  layout: 'Layout changed',
  hidden: 'Slide hidden',
  shown: 'Slide shown',
  background: 'Background changed',
  notes: 'Speaker notes changed',
  transition: 'Transition or animation changed',
  order: 'Stacking order changed',
}

const THUMB_WIDTH = 150

/**
 * Pictures of the two versions while they are compared. The page is not a secure context, so
 * WebCrypto (and the SHA-256 the shared stores use) is unavailable; a content hash that only has
 * to tell this comparison's images apart does instead. Equal bytes get equal keys in both
 * stores, so an unchanged picture reads as unchanged.
 */
class ScratchAssets implements LiveAssetStore {
  private readonly bytes = new Map<string, Uint8Array>()

  async put(bytes: Uint8Array, mimeType: string): Promise<LiveAssetRef> {
    const hash = contentKey(bytes)
    this.bytes.set(hash, bytes)
    return { hash, mimeType, sizeBytes: bytes.byteLength }
  }

  async get(hash: string): Promise<Uint8Array> {
    const found = this.bytes.get(hash)
    if (!found) throw new Error('Unknown asset')
    return found
  }
}

/** Two FNV-1a passes with different seeds, and the length: plenty to tell one deck's images apart. */
function contentKey(bytes: Uint8Array): string {
  let a = 0x811c9dc5
  let b = 0x01000193 ^ bytes.byteLength
  for (let index = 0; index < bytes.length; index++) {
    a = Math.imul(a ^ bytes[index]!, 0x01000193)
    b = Math.imul(b ^ bytes[index]!, 0x5bd1e995)
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}${bytes.byteLength.toString(16)}`
}

export interface ShownDiff {
  destroy(): void
}

/** Reads both versions and draws the comparison into `root`. Throws when a version is not a deck. */
export async function showPresentationDiff(root: HTMLElement, before: Uint8Array, after: Uint8Array): Promise<ShownDiff> {
  const stores = { before: new ScratchAssets(), after: new ScratchAssets() }
  const [left, right] = await Promise.all([readPresentation(before, { assets: stores.before }), readPresentation(after, { assets: stores.after })])
  const diff = diffSnapshots(left, right)
  const urls: string[] = []
  const [beforeUrls, afterUrls] = await Promise.all([imageUrls(diff.beforeSnapshot, stores.before, urls), imageUrls(diff.afterSnapshot, stores.after, urls)])
  root.replaceChildren(render(diff, beforeUrls, afterUrls))
  return {
    destroy() {
      root.replaceChildren()
      for (const url of urls) if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    },
  }
}

async function imageUrls(snapshot: PresentationSnapshot, assets: LiveAssetStore, created: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  for (const [path, part] of Object.entries(snapshot.parts)) {
    if (!part.asset?.mimeType.startsWith('image/') || !displayableMediaType(part.asset.mimeType)) continue
    try {
      const url = assetObjectUrl(await assets.get(part.asset.hash), part.asset.mimeType)
      if (!url) continue
      created.push(url)
      urls.set(path, url)
    } catch {
      // A missing image draws as a gray box.
    }
  }
  return urls
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function render(diff: PresentationDiff, beforeUrls: Map<string, string>, afterUrls: Map<string, string>): HTMLElement {
  const container = element('div', 'pd')
  container.dataset.presentationDiff = ''
  const summary = diff.changed ? `${diff.added} added · ${diff.removed} removed · ${diff.moved} moved · ${diff.edited} edited` : 'No changes'
  const deck = [diff.deck.includes('theme') || diff.deck.includes('masters') ? 'Theme or slide masters changed' : '', diff.deck.includes('size') ? 'Slide size changed' : '', diff.deck.includes('sections') ? 'Sections changed' : ''].filter(Boolean)
  const status = element('p', 'pd-summary', [summary, ...deck].join(' · '))
  status.setAttribute('role', 'status')
  container.append(status)
  const decks = { before: new DeckResources(diff.beforeSnapshot.parts, diff.beforeSnapshot.mainPart), after: new DeckResources(diff.afterSnapshot.parts, diff.afterSnapshot.mainPart) }
  diff.slides.forEach((row, index) => {
    if (row.status === 'unchanged') return
    const card = element('article', 'pd-card')
    card.dataset.status = row.status
    const header = element('header', 'pd-header')
    header.append(element('span', `pd-chip pd-${row.status}`, STATUS[row.status]))
    const number = row.after !== undefined ? `Slide ${row.after + 1}` : `Slide ${(row.before ?? 0) + 1}`
    const moved = row.status === 'moved' && row.before !== undefined && row.after !== undefined ? ` (was ${row.before + 1})` : ''
    header.append(element('span', 'pd-number', number + moved))
    if (row.title) header.append(element('span', 'pd-title', row.title))
    card.append(header)
    const thumbs = element('div', 'pd-thumbs')
    if (row.status !== 'added') thumbs.append(thumbnail(diff.beforeSnapshot, row.beforeKey, decks.before, beforeUrls, 'Before', `b${index}`))
    if (row.status !== 'removed') thumbs.append(thumbnail(diff.afterSnapshot, row.afterKey, decks.after, afterUrls, 'After', `a${index}`))
    card.append(thumbs)
    const list = element('ul', 'pd-changes')
    for (const change of row.slideChanges) list.append(element('li', undefined, SLIDE_CHANGES[change] ?? change))
    for (const shape of row.shapes) {
      const item = element('li')
      const name = element('strong', undefined, shape.name || 'Shape')
      item.append(name, document.createTextNode(`: ${shape.kinds.map((kind) => SHAPE_CHANGES[kind]).join(', ')}`))
      if (shape.kinds.includes('text') || shape.kinds.includes('table')) item.append(lineDiff(shape.textBefore ?? '', shape.textAfter ?? ''))
      list.append(item)
    }
    if (row.notesBefore !== undefined) {
      const item = element('li', undefined, 'Notes')
      item.append(lineDiff(row.notesBefore, row.notesAfter ?? ''))
      list.append(item)
    }
    if (list.childElementCount) card.append(list)
    container.append(card)
  })
  return container
}

function thumbnail(snapshot: PresentationSnapshot, slideKey: string | undefined, deck: DeckResources, urls: Map<string, string>, label: string, prefix: string): HTMLElement {
  const figure = element('figure', 'pd-thumb')
  const index = snapshot.slides.findIndex((slide) => slide.key === slideKey)
  const slide = snapshot.slides[index]
  const scale = THUMB_WIDTH / (snapshot.slideWidth / 9525)
  const frame = element('div', 'pd-frame')
  frame.style.width = `${THUMB_WIDTH}px`
  frame.style.height = `${(snapshot.slideHeight / 9525) * scale}px`
  if (slide) {
    const inner = element('div', 'pd-inner')
    inner.style.transform = `scale(${scale})`
    // The renderer's output: text and attributes escaped, images limited to the deck's own parts.
    inner.innerHTML = renderSlide(slide, snapshot, { deck, slideNumber: index + 1, mode: 'view', assetUrl: (path) => urls.get(path), idPrefix: `diff-${prefix}` })
    frame.append(inner)
  }
  figure.append(frame, element('figcaption', undefined, label))
  return figure
}

/** Lines removed and added, with unchanged lines around them (longest common subsequence). */
function lineDiff(before: string, after: string): HTMLElement {
  const a = before.split('\n')
  const b = after.split('\n')
  const box = element('div', 'pd-lines')
  if (a.length * b.length > 250_000) {
    for (const line of a) box.append(element('div', 'pd-removed', `− ${line}`))
    for (const line of b) box.append(element('div', 'pd-added', `+ ${line}`))
    return box
  }
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      box.append(element('div', 'pd-same', `  ${a[i]}`))
      i++
      j++
    } else if (i < a.length && (j >= b.length || table[i + 1]![j]! >= table[i]![j + 1]!)) {
      // Removed lines first, then what replaces them.
      box.append(element('div', 'pd-removed', `− ${a[i]}`))
      i++
    } else {
      box.append(element('div', 'pd-added', `+ ${b[j]}`))
      j++
    }
  }
  return box
}
