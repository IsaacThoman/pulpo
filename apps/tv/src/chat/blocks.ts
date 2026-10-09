import { Lexer, type Token, type Tokens } from 'marked'
import { linkMarkdownImages, normalizeMathDelimiters, unwrapBoxedMinipages } from '@pulpo/client-core'

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'break' }
  | { type: 'strong' | 'em' | 'del' | 'link'; children: Inline[] }

export type Block =
  | { type: 'heading'; depth: number; inline: Inline[] }
  | { type: 'paragraph'; inline: Inline[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'math'; text: string }
  | { type: 'list'; items: ListItem[] }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { type: 'rule' }

export interface ListItem {
  marker: string
  depth: number
  inline: Inline[]
}

// Hostile or runaway replies must not overflow the JS stack while rendering.
const MAX_DEPTH = 12

function decode(text: string): string {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

/** Inline `$…$` math stays readable as code: the TV has no TeX renderer. */
function textWithMath(text: string): Inline[] {
  const parts = decode(text).split(/(?<![\\$])\$(?!\$)([^$\n]+?)(?<!\\)\$/g)
  return parts.flatMap((part, index): Inline[] => {
    if (!part) return []
    return index % 2 === 1 ? [{ type: 'code', text: part }] : [{ type: 'text', text: part.replace(/\\\$/g, '$') }]
  })
}

function inlineTokens(tokens: Token[] | undefined, depth = 0): Inline[] {
  if (!tokens) return []
  if (depth > MAX_DEPTH) return [{ type: 'text', text: tokens.map((token) => token.raw).join('') }]
  return tokens.flatMap((token): Inline[] => {
    switch (token.type) {
      case 'strong':
      case 'em':
      case 'del':
      case 'link':
        return [{ type: token.type, children: inlineTokens((token as Tokens.Strong).tokens, depth + 1) }]
      case 'codespan':
        return [{ type: 'code', text: decode((token as Tokens.Codespan).text) }]
      case 'br':
        return [{ type: 'break' }]
      case 'text': {
        const text = token as Tokens.Text
        return text.tokens ? inlineTokens(text.tokens, depth + 1) : textWithMath(text.text)
      }
      case 'escape':
        return [{ type: 'text', text: decode((token as Tokens.Escape).text) }]
      case 'html':
        return [{ type: 'text', text: decode(token.raw) }]
      default:
        return 'tokens' in token && Array.isArray(token.tokens)
          ? inlineTokens(token.tokens as Token[], depth + 1)
          : textWithMath('text' in token && typeof token.text === 'string' ? token.text : token.raw)
    }
  })
}

function listItems(list: Tokens.List, depth: number): ListItem[] {
  const start = typeof list.start === 'number' ? list.start : 1
  return list.items.flatMap((item, index) => {
    const marker = item.task ? (item.checked ? '☑' : '☐') : list.ordered ? `${start + index}.` : '•'
    const inline: Inline[] = []
    const nested: ListItem[] = []
    for (const child of item.tokens) {
      if (child.type === 'list') {
        if (depth < MAX_DEPTH) nested.push(...listItems(child as Tokens.List, depth + 1))
      } else {
        if (inline.length) inline.push({ type: 'break' })
        inline.push(...inlineTokens(child.type === 'text' || child.type === 'paragraph'
          ? (child as Tokens.Text).tokens ?? [child]
          : [child]))
      }
    }
    return [{ marker, depth, inline }, ...nested]
  })
}

function blocksFromTokens(tokens: Token[], depth = 0): Block[] {
  return tokens.flatMap((token): Block[] => {
    switch (token.type) {
      case 'heading':
        return [{ type: 'heading', depth: (token as Tokens.Heading).depth, inline: inlineTokens((token as Tokens.Heading).tokens) }]
      case 'paragraph': {
        const raw = token.raw.trim()
        const math = /^\$\$([\s\S]+)\$\$$/.exec(raw)
        if (math) return [{ type: 'math', text: math[1]!.trim() }]
        return [{ type: 'paragraph', inline: inlineTokens((token as Tokens.Paragraph).tokens) }]
      }
      case 'text':
        return [{ type: 'paragraph', inline: inlineTokens((token as Tokens.Text).tokens ?? [token]) }]
      case 'code':
        return [{ type: 'code', lang: (token as Tokens.Code).lang ?? '', text: (token as Tokens.Code).text }]
      case 'list':
        return [{ type: 'list', items: listItems(token as Tokens.List, 0) }]
      case 'blockquote':
        return depth < MAX_DEPTH
          ? [{ type: 'quote', blocks: blocksFromTokens((token as Tokens.Blockquote).tokens, depth + 1) }]
          : [{ type: 'paragraph', inline: [{ type: 'text', text: (token as Tokens.Blockquote).text }] }]
      case 'table': {
        const table = token as Tokens.Table
        return [{
          type: 'table',
          header: table.header.map((cell) => inlineTokens(cell.tokens)),
          rows: table.rows.map((row) => row.map((cell) => inlineTokens(cell.tokens))),
        }]
      }
      case 'hr':
        return [{ type: 'rule' }]
      case 'space':
        return []
      case 'html':
        return token.raw.trim() ? [{ type: 'paragraph', inline: [{ type: 'text', text: decode(token.raw.trim()) }] }] : []
      default:
        return token.raw.trim() ? [{ type: 'paragraph', inline: [{ type: 'text', text: token.raw.trim() }] }] : []
    }
  })
}

export function parseMarkdown(markdown: string): Block[] {
  const source = linkMarkdownImages(normalizeMathDelimiters(unwrapBoxedMinipages(markdown), { displayMathStyle: 'multiline' }))
  try {
    return blocksFromTokens(new Lexer({ gfm: true }).lex(source))
  } catch {
    return [{ type: 'paragraph', inline: [{ type: 'text', text: markdown }] }]
  }
}

export function inlineText(inline: Inline[]): string {
  return inline.map((node) => node.type === 'break' ? '\n' : 'children' in node ? inlineText(node.children) : node.text).join('')
}

function blockLength(block: Block): number {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return inlineText(block.inline).length
    case 'code':
    case 'math':
      return block.text.length
    case 'list':
      return block.items.reduce((total, item) => total + inlineText(item.inline).length + 8, 0)
    case 'quote':
      return block.blocks.reduce((total, child) => total + blockLength(child), 0)
    case 'table':
      return (block.rows.length + 1) * 80
    case 'rule':
      return 0
  }
}

/** Characters that comfortably fit on screen at TV reading size. */
const PAGE_BUDGET = 700
const LIST_CHUNK = 6

/**
 * Group blocks into the stops the remote moves between. Each stop is roughly a
 * screenful, so a long reply scrolls in readable steps instead of one giant view.
 */
export function pageBlocks(blocks: Block[]): Block[][] {
  const expanded = blocks.flatMap((block): Block[] => {
    if (block.type !== 'list' || block.items.length <= LIST_CHUNK || blockLength(block) <= PAGE_BUDGET) return [block]
    const chunks: Block[] = []
    for (let index = 0; index < block.items.length; index += LIST_CHUNK) {
      chunks.push({ type: 'list', items: block.items.slice(index, index + LIST_CHUNK) })
    }
    return chunks
  })
  const pages: Block[][] = []
  let page: Block[] = []
  let size = 0
  expanded.forEach((block, index) => {
    const length = blockLength(block)
    const attachesToHeading = page.at(-1)?.type === 'heading'
    // A heading moves to the next page with the block it introduces.
    const following = block.type === 'heading' ? blockLength(expanded[index + 1] ?? block) : 0
    if (page.length && !attachesToHeading && size + length + following > PAGE_BUDGET) {
      pages.push(page)
      page = []
      size = 0
    }
    page.push(block)
    size += length
  })
  if (page.length) pages.push(page)
  return pages
}
