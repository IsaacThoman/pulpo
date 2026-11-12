import type { ReactNode } from 'react'

/** Bold, italic, and link spans. Markers whose closing pair has not streamed in yet stay visible, as in the apps. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/).map((part, index) => {
    if (index % 2 === 0) return part
    // A bold span can wrap a link, as in a list of named places.
    if (part.startsWith('**')) return <strong key={index} className="font-semibold">{inline(part.slice(2, -2))}</strong>
    if (part.startsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>
    return <span key={index} className="underline underline-offset-2">{part.slice(1, part.indexOf(']('))}</span>
  })
}

type Block = { kind: 'p'; text: string } | { kind: 'ul' | 'ol'; items: string[] }

function blocks(text: string): Block[] {
  const result: Block[] = []
  let blank = true
  // An image the answer embeds is the file shown under it, so its Markdown is left out, even while it streams in.
  for (const line of text.replace(/!\[[^\]]*\]\([^)]*\)|!\[[^\]]*(?:\]\([^)]*)?$/g, '').split('\n')) {
    if (!line.trim()) {
      blank = true
      continue
    }
    const bullet = /^[-*] (.*)$/.exec(line)
    const numbered = /^\d+\. (.*)$/.exec(line)
    const kind = bullet ? 'ul' : numbered ? 'ol' : 'p'
    const content = bullet?.[1] ?? numbered?.[1] ?? line
    const previous = result.at(-1)
    if (kind !== 'p' && previous?.kind === kind) previous.items.push(content)
    // Lines that follow one another without a blank line between them are one paragraph, as in a poem.
    else if (kind === 'p' && previous?.kind === 'p' && !blank) previous.text += `\n${content}`
    else result.push(kind === 'p' ? { kind, text: content } : { kind, items: [content] })
    blank = false
  }
  return result
}

/**
 * The little Markdown the demo's answers use: paragraphs, lists, bold, italics, and links. The app's own renderer is a
 * separate lazy chunk with math and code highlighting, which the landing page should not pull in.
 */
export function MarkdownLite({ text, cursor, listClassName }: { text: string; cursor: boolean; listClassName: string }) {
  const parsed = blocks(text)
  const caret = cursor ? <span className="ml-[0.1em] inline-block h-[1em] w-[0.5em] translate-y-[0.15em] bg-current" /> : null
  return (
    <>
      {parsed.map((block, index) => {
        const last = index === parsed.length - 1
        if (block.kind === 'p') return <p key={index} className="whitespace-pre-line">{inline(block.text)}{last ? caret : null}</p>
        const List = block.kind
        return (
          <List key={index} className={listClassName}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{inline(item)}{last && itemIndex === block.items.length - 1 ? caret : null}</li>
            ))}
          </List>
        )
      })}
    </>
  )
}
