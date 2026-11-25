import type { CurrencyResponse } from './currency'
import { safeHttpUrl } from './navigation'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' })

export function CurrencyAnswer({ quote, onWeb }: {
  quote: Extract<CurrencyResponse, { status: 'converted' }>
  onWeb: () => void
}) {
  const source = safeHttpUrl(quote.source.url)
  return (
    <section className="answer instant-answer currency-answer" aria-label="Currency conversion">
      <h2>Currency conversion</h2>
      <p>{quote.amount} {quote.from} equals</p>
      <output>{quote.converted} {quote.to}</output>
      <p>1 {quote.from} = {quote.rate} {quote.to}</p>
      <div className="weather-footer">
        <span>{source && <><a href={source.href} rel="noreferrer">{quote.source.name}</a> · </>}
          Reference rate for {dateFormat.format(new Date(quote.referenceDate + 'T12:00:00Z'))}</span>
        <button className="text-button weather-web" onClick={onWeb}>Search the web</button>
      </div>
    </section>
  )
}
