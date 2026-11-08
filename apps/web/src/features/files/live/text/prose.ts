/** Files people write prose in rather than code: they show a word count, and spell check by default. */
const PROSE = /\.(txt|text|log|md|markdown|mdx|rst|adoc|asciidoc|org|tex|srt|vtt)$|^(readme|license|licence|changelog|authors|contributing|notice|copying)(\.[^.]*)?$/i

export function isProseFile(name: string): boolean {
  return PROSE.test(name)
}
