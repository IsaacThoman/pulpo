import { ArrowLeftRight } from 'lucide-react'
import { useState } from 'react'
import { currencyCodes, parseCurrencyQuery, type CurrencyResponse } from './currency'
import { safeHttpUrl } from './navigation'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' })

export function CurrencyAnswer({ quote, onConvert, onWeb }: {
  quote: Extract<CurrencyResponse, { status: 'converted' }>
  onConvert: (query: string) => void
  onWeb: () => void
}) {
  const source = safeHttpUrl(quote.source.url)
  const [amount, setAmount] = useState(quote.amount)
  const [from, setFrom] = useState(quote.from)
  const [to, setTo] = useState(quote.to)
  const [showError, setShowError] = useState(false)
  function convert(fromCode = from, toCode = to) {
    const query = parseCurrencyQuery(amount.trim() + ' ' + fromCode + ' to ' + toCode)
    setShowError(!query)
    if (query) onConvert(query.amount + ' ' + query.from + ' to ' + query.to)
  }
  return (
    <section className="answer instant-answer currency-answer" aria-label="Currency conversion">
      <h2>Currency conversion</h2>
      <p>{quote.amount} {quote.from} equals</p>
      <output>{quote.converted} {quote.to}</output>
      <p>1 {quote.from} = {quote.rate} {quote.to}</p>
      <form className="currency-controls" onSubmit={event => { event.preventDefault(); convert() }}>
        <input aria-label="Amount" inputMode="decimal" value={amount} maxLength={24}
          onChange={event => { setAmount(event.target.value); setShowError(false) }} aria-invalid={showError || undefined} />
        <select aria-label="From currency" value={from} onChange={event => setFrom(event.target.value)}>
          {currencyCodes.map(code => <option key={code}>{code}</option>)}
        </select>
        <button className="icon-button" type="button" aria-label="Swap currencies" onClick={() => {
          setFrom(to)
          setTo(from)
          convert(to, from)
        }}><ArrowLeftRight size={15} aria-hidden="true" /></button>
        <select aria-label="To currency" value={to} onChange={event => setTo(event.target.value)}>
          {currencyCodes.map(code => <option key={code}>{code}</option>)}
        </select>
        <button className="secondary-button" type="submit">Convert</button>
      </form>
      {showError && <p role="alert">Enter a valid amount.</p>}
      <div className="weather-footer">
        <span>{source && <><a href={source.href} rel="noreferrer">{quote.source.name}</a> · </>}
          Reference rate for {dateFormat.format(new Date(quote.referenceDate + 'T12:00:00Z'))}</span>
        <button className="text-button weather-web" onClick={onWeb}>Search the web</button>
      </div>
    </section>
  )
}
