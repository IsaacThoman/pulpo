import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model'
import { inlineMarks } from './schema.js'

/** Editing-session identifiers do not affect content or layout. Keep the exclusion narrow. */
function noise(name: string): boolean {
  return /^w:rsid(?:R|RPr|RDefault|P|Del|Sect|Tr)?$/.test(name)
}

/** Stable JSON/JsonML, preserving child order and text, but ignoring XML attribute order. */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value[0] === 'w:rsids') return null
    return value.map(normalize).filter((entry) => entry !== null)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key, entry]) => !noise(key) && entry !== null && entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, normalize(entry)]))
  }
  return value
}

/** Parse only packed attribute values, never document text or strings inside preserved XML. */
function unpack(value: unknown): unknown {
  if (typeof value !== 'string' || !/^\s*[[{]/.test(value)) return value
  try { return JSON.parse(value) } catch { return value }
}

export function canonicalValue(value: unknown): string {
  return JSON.stringify(normalize(unpack(value))) ?? 'null'
}

export function reviewAttrs(attrs: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue
    const normalized = normalize(unpack(value))
    if (key === 'xmlAttrs' && normalized && typeof normalized === 'object' && !Object.keys(normalized).length) continue
    result[key] = normalized
  }
  return result
}

export function canonicalMarks(marks: readonly Mark[]): unknown[] {
  return marks.map((mark) => ({ type: mark.type.name, attrs: reviewAttrs(mark.attrs) }))
}

export function reviewNode(node: ProseMirrorNode): unknown {
  return {
    type: node.type.name,
    attrs: reviewAttrs(Object.fromEntries(Object.entries(node.attrs).filter(([key]) => key !== 'marks'))),
    marks: canonicalMarks(inlineMarks(node)),
    ...(node.isText ? { text: node.text } : { content: node.content.content.map(reviewNode) }),
  }
}

export function canonicalNode(node: ProseMirrorNode): string {
  return canonicalValue(reviewNode(node))
}
