import type * as Y from 'yjs'
import { applyMarkdownToYDoc, ydocToMarkdown } from '../../doc-schema/index.js'
import { transactChanges } from '../assets.js'
import { MARKDOWN_FORMAT } from '../formats.js'
import { LiveFormatError, type LiveFormatCodec } from '../live-format.js'

/**
 * Markdown documents through the live-format interface. Their Y.Doc layout and schema stay those
 * of `doc-schema` (a ProseMirror fragment edited by TipTap); this adapter only lets generic code
 * paths (conversion, export, search text) handle them like any other format. Agent edits to
 * Markdown keep their own path, which turns pushes into inline suggestions.
 */

function markdownText(bytes: Uint8Array): string {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new LiveFormatError('unsupported', 'This file is not UTF-8 text, so it cannot be edited')
  }
  if (text.length > MARKDOWN_FORMAT.maxFileBytes) throw new LiveFormatError('too_large', 'This file is too large to edit')
  return text.replace(/^﻿/, '')
}

function applyMarkdown(doc: Y.Doc, markdown: string, origin: unknown): void {
  try {
    applyMarkdownToYDoc(doc, markdown, origin)
  } catch (error) {
    // The Markdown parser rejects a few malformed inputs.
    throw new LiveFormatError('corrupt', 'This Markdown could not be read; simplify it and try again', { cause: error })
  }
}

export const markdownCodec: LiveFormatCodec = {
  id: MARKDOWN_FORMAT.id,
  schemaVersion: MARKDOWN_FORMAT.schemaVersion,
  extensions: MARKDOWN_FORMAT.extensions,
  mimeType: MARKDOWN_FORMAT.mimeType,

  async createEmpty() {
    // An empty fragment is an empty document; the editor adds its first paragraph.
  },

  async importFile(doc, bytes) {
    const markdown = markdownText(bytes)
    if (markdown.trim()) applyMarkdown(doc, markdown, 'import')
  },

  async exportFile(doc) {
    return new TextEncoder().encode(ydocToMarkdown(doc))
  },

  async applyFile(doc, bytes, _context, origin) {
    const markdown = markdownText(bytes)
    // The outer transaction carries `origin`; the nested one inside joins it.
    return { changed: transactChanges(doc, () => applyMarkdown(doc, markdown, origin), origin) }
  },

  toText(doc) {
    return ydocToMarkdown(doc)
  },
}
