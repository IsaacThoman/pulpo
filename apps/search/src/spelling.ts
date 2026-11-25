import type { SearchResponse } from './api'
import { safeHttpUrl } from './navigation'

const plainQuery = /^[\p{L}\p{N}]+(?:\s+[\p{L}\p{N}]+)*$/u
const letters = /^\p{L}+$/u
const words = /[\p{L}\p{N}]+/gu

function singleEdit(original: string, candidate: string) {
  const left = [...original]
  const right = [...candidate]
  if (!letters.test(original) || !letters.test(candidate)
    || Math.min(left.length, right.length) < 5 || Math.abs(left.length - right.length) > 1) return false
  const first = left.findIndex((char, index) => char !== right[index])
  if (left.length === right.length) {
    return first >= 0 && (
      left.slice(first + 1).join('') === right.slice(first + 1).join('')
      || (left[first] === right[first + 1]
        && left[first + 1] === right[first] && left.slice(first + 2).join('') === right.slice(first + 2).join(''))
    )
  }
  const longer = left.length > right.length ? left : right
  const shorter = left.length > right.length ? right : left
  const index = first === -1 ? shorter.length : first
  return longer.slice(0, index).concat(longer.slice(index + 1)).join('') === shorter.join('')
}

export function suggestedSpelling(query: string, data: SearchResponse) {
  if (!plainQuery.test(query)) return
  const queryWords = query.split(/\s+/)
  const original = queryWords.map(word => word.toLowerCase())
  const sources = data.results.slice(0, 8).flatMap(result => {
    const url = safeHttpUrl(result.url)
    return url ? [{
      host: url.hostname.replace(/^www\./, ''), page: url.origin + url.pathname,
      title: new Set(result.title.toLowerCase().match(words)),
      excerpt: new Set(result.snippet.slice(0, 300).toLowerCase().match(words)),
    }] : []
  })

  let combined: string | undefined
  for (const [position, suggestion] of (data.related ?? []).slice(0, 8).entries()) {
    if (!plainQuery.test(suggestion)) continue
    const candidate = suggestion.toLowerCase().split(/\s+/)
    if (candidate.length !== original.length) continue
    const differences = original.flatMap((word, index) => word === candidate[index] ? [] : [index])
    const replacements = differences.filter(index => singleEdit(original[index], candidate[index])
      && !sources.some(source => source.title.has(original[index])))
    if (differences.length === 1 && replacements.length === 1) {
      const agreement = sources.filter(source => source.title.has(candidate[replacements[0]]))
      if (new Set(agreement.map(source => source.host)).size >= 2
        || (position === 0 && agreement[0] === sources[0] && new Set(agreement.map(source => source.page)).size >= 2)) return suggestion
    }
    if (combined || replacements.length !== 2 || differences.length > 3) continue
    const corrected = replacements.map(index => candidate[index])
    const matchTogether = sources.slice(0, 4).some(source => corrected.every(word => source.title.has(word)))
    const corroborated = corrected.every(word => new Set(sources
      .filter(source => source.title.has(word) || source.excerpt.has(word)).map(source => source.host)).size >= 2)
    if (matchTogether && corroborated) {
      combined = queryWords.map((word, index) => replacements.includes(index) ? candidate[index] : word).join(' ')
    }
  }
  if (combined) return combined

  // Some providers omit spelling metadata. Propose edits only when independent result
  // hosts corroborate them and a ranked result contains the edits and a retained term.
  if (original.length < 2 || original.length > 12) return
  const leadingWords = new Set(sources.slice(0, 6).flatMap(source => [...source.title]))
  const contains = (source: (typeof sources)[number], word: string) => source.title.has(word) || source.excerpt.has(word)
  const corrected = original.map(word => {
    if (sources.some(source => source.title.has(word))) return word
    const matches = [...leadingWords].filter(candidate => singleEdit(word, candidate)
      && new Set(sources.filter(source => contains(source, candidate)).map(source => source.host)).size >= 2)
    return matches.length === 1 ? matches[0]! : word
  })
  const changed = corrected.filter((word, index) => word !== original[index])
  const anchors = original.filter((word, index) => word.length >= 4 && word === corrected[index])
  if (changed.length === 0 || changed.length > 2
    || !sources.slice(0, 6).some(source => changed.every(word => contains(source, word))
      && anchors.some(word => contains(source, word)))) return
  return queryWords.map((word, index) => corrected[index] === original[index] ? word : corrected[index]).join(' ')
}
