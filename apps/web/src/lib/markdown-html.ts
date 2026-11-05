import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize'
import type { Options } from 'react-markdown'

/**
 * HTML inside untrusted Markdown (notebook cells), parsed and then sanitized with GitHub's rules:
 * no scripts, styles, event handlers, forms, or frames, and ids prefixed so they can't clobber the
 * page's. Embedded images never load from the network (`<picture>` and `srcset` are dropped; the
 * caller's image component shows remote images as links). Math classes from remark-math survive so KaTeX still renders, and image sources may be
 * `data:` or `attachment:` URLs, which the caller's URL transform then checks.
 */
const schema: SanitizeSchema = {
  ...defaultSchema,
  // `<source srcset>` would load a remote image the URL transform never sees.
  tagNames: (defaultSchema.tagNames ?? []).filter((tag) => tag !== 'picture' && tag !== 'source'),
  // Removed with their contents, rather than unwrapped into visible CSS or code.
  strip: [...(defaultSchema.strip ?? []), 'style'],
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
