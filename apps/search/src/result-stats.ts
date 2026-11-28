import { providerNames, type SearchResponse } from './api'

export interface ResultStats {
  /** Time spent fetching the results shown, in milliseconds. */
  elapsedMs?: number
  /** Engines that supplied the results shown. */
  providers: SearchResponse['provider'][]
}

// Search's copy is English, so plurals and lists follow English rules while numbers follow the reader's locale.
const plural = new Intl.PluralRules('en')
const list = new Intl.ListFormat('en', { type: 'conjunction' })
const count = new Intl.NumberFormat()
const seconds = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** A quiet summary such as “10 results from Kagi in 1.82 seconds”. */
export function formatResultStats(results: number, { elapsedMs, providers }: ResultStats) {
  const engines = providers.length ? ' from ' + list.format(providers.map(provider => providerNames[provider])) : ''
  const time = elapsedMs === undefined || !Number.isFinite(elapsedMs) ? '' : ` in ${seconds.format(Math.max(0, elapsedMs) / 1000)} seconds`
  return `${count.format(results)} ${plural.select(results) === 'one' ? 'result' : 'results'}${engines}${time}`
}
