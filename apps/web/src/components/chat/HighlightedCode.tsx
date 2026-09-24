import { useMemo } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { highlightTree } from '@/lib/syntax-highlight'

/**
 * Syntax-coloured token spans for `code`. Render inside an element with the `code-highlight` class;
 * falls back to the raw string for unknown languages and oversized input. `language` follows
 * `highlightTree`: a fence tag or grammar, `undefined`/empty to guess, `null` for plain text.
 */
export function HighlightedCode({ code, language }: { code: string; language?: string | null }) {
  return useMemo(() => {
    const tree = highlightTree(code, language)
    return tree ? toJsxRuntime(tree, { Fragment, jsx, jsxs }) : code
  }, [code, language])
}
