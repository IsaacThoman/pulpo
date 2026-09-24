export { normalizeMathDelimiters } from '@pulpo/client-core'

// Some models put an entire prose document inside a LaTeX minipage and box it
// as one display equation. The native math renderer cannot parse document
// environments or nested display math, so expose the prose and inner equations
// to the Markdown renderer instead.
const boxedMinipage = /\\\[\s*\\boxed\{\s*\\begin\{minipage\}\{[^}\n]+\}([\s\S]*?)\\end\{minipage\}\s*\}\s*\\\]/g

export function unwrapBoxedMinipages(content: string): string {
  return content.split(/(```[\s\S]*?```|`[^`\n]+`)/g).map((part, index) => {
    if (index % 2 === 1) return part
    return part.replace(boxedMinipage, (_match, body: string) => {
      let item = 0
      const markdown = body.trim()
        .replace(/^[ \t]*\\textbf\{([^{}]*)\}[ \t]*$/gm, '**$1**')
        .replace(/^[ \t]*\\begin\{enumerate\}[ \t]*$/gm, '')
        .replace(/^[ \t]*\\end\{enumerate\}[ \t]*$/gm, '')
        .replace(/^[ \t]*\\item[ \t]+/gm, () => `\n\n**${++item}.** `)
        .trim()
      return `\n\n${markdown}\n\n`
    })
  }).join('')
}

/** Whether the first visible Markdown block is an ATX heading. */
export function beginsWithMarkdownHeading(content: string): boolean {
  return /^(?:[ \t]*\r?\n)*[ \t]{0,3}#{1,6}(?:[ \t]+|$)/.test(content)
}
