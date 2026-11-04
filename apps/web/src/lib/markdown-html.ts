import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize'
import type { Options } from 'react-markdown'

/**
 * HTML inside untrusted Markdown (notebook cells), parsed and then sanitized with GitHub's rules:
 * no scripts, styles, event handlers, forms, or frames, and ids prefixed so they can't clobber the
 * page's. Math classes from remark-math survive so KaTeX still renders, and image sources may be
 * `data:` or `attachment:` URLs, which the caller's URL transform then checks.
 */
const schema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [['className', /^language-./, 'math-inline', 'math-display']],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), 'data', 'attachment'],
  },
}

export const SANITIZED_HTML_PLUGINS: NonNullable<Options['rehypePlugins']> = [rehypeRaw, [rehypeSanitize, schema]]
