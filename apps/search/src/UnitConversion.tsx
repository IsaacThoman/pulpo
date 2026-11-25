import { ArrowLeftRight } from 'lucide-react'
import { useId, useState } from 'react'
import { compatibleUnits, evaluateUnitConversion, type UnitConversionInput } from './instant-answer'
import './unit-conversion.css'

interface UnitConversionProps {
  initialConversion: UnitConversionInput
  onConvert: (query: string) => void
  onSearchWeb: (query: string) => void
}

export function UnitConversion({ initialConversion, onConvert, onSearchWeb }: UnitConversionProps) {
  const [draft, setDraft] = useState(initialConversion)
  const controlsId = useId()
  const options = compatibleUnits(initialConversion.from)
  const answer = evaluateUnitConversion(draft)
  const changed = draft.amount.trim() !== initialConversion.amount
    || draft.from !== initialConversion.from || draft.to !== initialConversion.to
  const amountInvalid = !!draft.amount.trim() && !answer
  const query = draft.amount.trim() + ' ' + draft.from + ' to ' + draft.to

  return (
    <section className="answer unit-conversion" aria-labelledby={controlsId + '-title'}>
      <h2 id={controlsId + '-title'}>Unit conversion</h2>
      <form onSubmit={event => {
        event.preventDefault()
        if (answer && changed) onConvert(query)
      }}>
        <div className="unit-conversion-values">
          <div className="unit-conversion-field">
            <label htmlFor={controlsId + '-amount'}>Amount</label>
            <input id={controlsId + '-amount'} inputMode="decimal" autoComplete="off" maxLength={100}
              value={draft.amount} aria-invalid={amountInvalid || undefined}
              aria-describedby={amountInvalid ? controlsId + '-error' : undefined}
              onChange={event => setDraft({ ...draft, amount: event.target.value })} />
            <label className="sr-only" htmlFor={controlsId + '-from'}>From unit</label>
            <select id={controlsId + '-from'} value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })}>
              {options.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
            </select>
          </div>
          <button className="icon-button unit-conversion-swap" type="button" aria-label="Swap units"
            onClick={() => setDraft({ ...draft, from: draft.to, to: draft.from })}>
            <ArrowLeftRight size={16} aria-hidden="true" />
          </button>
          <div className="unit-conversion-field">
            <span aria-hidden="true">Result</span>
            <output htmlFor={controlsId + '-amount ' + controlsId + '-from ' + controlsId + '-to'}
              aria-label="Conversion result" aria-live="polite">{answer?.result ?? '—'}</output>
            <label className="sr-only" htmlFor={controlsId + '-to'}>To unit</label>
            <select id={controlsId + '-to'} value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })}>
              {options.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
            </select>
          </div>
        </div>
        {amountInvalid && <p id={controlsId + '-error'} className="form-error">Enter a valid amount.</p>}
        <div className="unit-conversion-actions">
          <button className="secondary-button" type="submit" disabled={!answer || !changed}>Apply</button>
          <button className="text-button" type="button" disabled={!answer} onClick={() => onSearchWeb(query)}>Search the web</button>
        </div>
      </form>
    </section>
  )
}
