import type { SearchResponse } from './api'
import { safeHttpUrl } from './navigation'

const literalWords = /^[\p{L}]+(?:\s+[\p{L}]+)*$/u
const words = /\p{L}+/gu

function singleEdit(original: string, candidate: string) {
  const left = [...original]
  const right = [...candidate]
  if (Math.min(left.length, right.length) < 5 || Math.abs(left.length - right.length) > 1) return false
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
  if (!literalWords.test(query) || !data.related?.length) return
  const original = query.toLowerCase().split(/\s+/)
  const sources = data.results.slice(0, 8).flatMap(result => {
    const url = safeHttpUrl(result.url)
    return url ? [{
      host: url.hostname.replace(/^www\./, ''), page: url.origin + url.pathname,
      title: new Set(result.title.toLowerCase().match(words)),
    }] : []
  })

  for (const [position, suggestion] of data.related.slice(0, 4).entries()) {
    if (!literalWords.test(suggestion)) continue
    const candidate = suggestion.toLowerCase().split(/\s+/)
    if (candidate.length !== original.length) continue
    const differences = original.flatMap((word, index) => word === candidate[index] ? [] : [index])
    if (differences.length !== 1) continue
    const [index] = differences
    if (!singleEdit(original[index], candidate[index]) || sources.some(source => source.title.has(original[index]))) continue
    const agreement = sources.filter(source => source.title.has(candidate[index]))
    if (new Set(agreement.map(source => source.host)).size >= 2
      || (position === 0 && agreement[0] === sources[0] && new Set(agreement.map(source => source.page)).size >= 2)) return suggestion
  }
}
