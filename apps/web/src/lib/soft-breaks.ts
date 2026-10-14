interface MdastText {
  type: 'text'
  value: string
}

type MdastNode = MdastText | { type: string; children?: MdastNode[] }

interface MdastParent {
  children: MdastNode[]
}

function splitLines(node: MdastText): MdastNode[] {
  return node.value.split(/\r?\n|\r/).flatMap((line, index) => {
    const parts: MdastNode[] = index > 0 ? [{ type: 'break' }] : []
    if (line) parts.push({ type: 'text', value: line })
    return parts
  })
}

function breakLines(parent: MdastParent) {
  parent.children = parent.children.flatMap((child) => {
    if (child.type === 'text') return splitLines(child as MdastText)
    if ('children' in child && child.children) breakLines(child as MdastParent)
    return [child]
  })
}

/** Turns soft line breaks into hard ones (like remark-breaks) so typed newlines survive rendering. Code and math keep theirs. */
export function remarkSoftBreaks() {
  return (tree: MdastParent) => breakLines(tree)
}
