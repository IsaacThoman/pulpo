import { useId, useLayoutEffect, useRef, useState } from 'react'
import { calculatorMaxLength, evaluateCalculation, formatCalculation, initialCalculatorAngle, type CalculatorAngle } from './instant-answer'
import './calculator.css'

const basicKeys = [
  ['(', 'Open parenthesis'], [')', 'Close parenthesis'], ['%', 'Percent'],
  ['7'], ['8'], ['9'], ['÷', 'Divide'],
  ['4'], ['5'], ['6'], ['×', 'Multiply'],
  ['1'], ['2'], ['3'], ['−', 'Subtract'],
  ['0'], ['.'], ['='], ['+', 'Add'],
] as const

const scientificKeys = [
  ['sqrt', 'Square root'], ['abs', 'Absolute value'], ['log', 'Base ten logarithm'], ['ln', 'Natural logarithm'],
  ['sin', 'Sine'], ['cos', 'Cosine'], ['tan', 'Tangent'], ['exp', 'Exponential'],
] as const

interface CalculatorProps {
  initialExpression: string
  onSearchWeb: (expression: string) => void
}

export function Calculator({ initialExpression, onSearchWeb }: CalculatorProps) {
  const named = /^(?:scientific )?calculator$/i.test(initialExpression)
  const [expression, setExpression] = useState(named ? '' : initialExpression)
  const [scientific, setScientific] = useState(/\b(?:scientific|sqrt|abs|log|ln|sin|cos|tan|exp)\b/i.test(initialExpression))
  const [angle, setAngle] = useState<CalculatorAngle>(() => initialCalculatorAngle(initialExpression))
  const [showKeypad, setShowKeypad] = useState(true)
  const [error, setError] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const pendingSelection = useRef<number | null>(null)
  const titleId = useId()
  const inputId = useId()
  const statusId = useId()
  const keypadId = useId()
  const result = evaluateCalculation(expression, angle)
  const showAngles = scientific || /\b(?:sin|cos|tan)\s*\(/i.test(expression)

  useLayoutEffect(() => {
    if (pendingSelection.current === null) return
    field.current?.setSelectionRange(pendingSelection.current, pendingSelection.current)
    pendingSelection.current = null
  }, [expression])

  function change(next: string, cursor?: number) {
    if (next.length > calculatorMaxLength) return
    if (next !== expression && cursor !== undefined) pendingSelection.current = cursor
    setExpression(next)
    setError(false)
    setCopyStatus('')
  }

  function insert(text: string, asFunction = false) {
    const start = field.current?.selectionStart ?? expression.length
    const end = field.current?.selectionEnd ?? start
    if (asFunction) {
      const selected = expression.slice(start, end)
      const replacement = text + '(' + selected + (selected ? ')' : '')
      change(expression.slice(0, start) + replacement + expression.slice(end), start + replacement.length)
      return
    }
    change(expression.slice(0, start) + text + expression.slice(end), start + text.length)
  }

  function backspace() {
    const start = field.current?.selectionStart ?? expression.length
    const end = field.current?.selectionEnd ?? start
    const from = start === end ? Math.max(0, start - 1) : start
    change(expression.slice(0, from) + expression.slice(end), from)
  }

  function calculate() {
    if (result === undefined) {
      setError(true)
      return
    }
    const next = String(result)
    change(next, next.length)
  }

  async function copy() {
    if (result === undefined) return
    try {
      await navigator.clipboard.writeText(String(result))
      setCopyStatus('Result copied')
    } catch {
      setCopyStatus('Couldn’t copy result')
    }
  }

  return (
    <section className="answer calculator" aria-labelledby={titleId}>
      <h2 id={titleId}>Calculator</h2>
      <form onSubmit={event => { event.preventDefault(); calculate() }}>
        <div className="calculator-display">
          <label htmlFor={inputId}>Expression</label>
          <input id={inputId} ref={field} type="text" autoComplete="off" spellCheck={false} maxLength={calculatorMaxLength}
            value={expression} aria-invalid={error || undefined} aria-describedby={statusId}
            onChange={event => change(event.target.value)}
            onKeyDown={event => {
              if (event.key !== '=' || event.nativeEvent.isComposing) return
              event.preventDefault()
              calculate()
            }} />
          <output htmlFor={inputId} aria-label="Calculation result" aria-live="polite">{result === undefined ? '—' : formatCalculation(result)}</output>
        </div>
        <div id={statusId} className="calculator-error" role="status">
          {error && 'Enter a valid expression with a finite result.'}
        </div>
        <div className="calculator-toolbar">
          <button type="button" className="text-button" aria-expanded={showKeypad} aria-controls={keypadId} onClick={() => setShowKeypad(value => !value)}>
            {showKeypad ? 'Hide keypad' : 'Show keypad'}
          </button>
          <button type="button" className="text-button" aria-pressed={scientific} onClick={() => {
            setScientific(value => !value)
            setShowKeypad(true)
          }}>Scientific</button>
          <button type="button" className="text-button" disabled={result === undefined} onClick={() => { void copy() }}>Copy result</button>
          <span role="status" aria-live="polite">{copyStatus}</span>
        </div>
        {showAngles && (
          <fieldset className="calculator-angles">
            <legend>Angles</legend>
            <label><input type="radio" name={inputId + '-angle'} checked={angle === 'degrees'} onChange={() => { setAngle('degrees'); setError(false); setCopyStatus('') }} /> Degrees</label>
            <label><input type="radio" name={inputId + '-angle'} checked={angle === 'radians'} onChange={() => { setAngle('radians'); setError(false); setCopyStatus('') }} /> Radians</label>
          </fieldset>
        )}
        <div id={keypadId} hidden={!showKeypad}>
          {scientific && (
            <div className="calculator-keys calculator-scientific" role="group" aria-label="Scientific keypad">
              {scientificKeys.map(([value, label]) => (
                <button type="button" key={value} aria-label={label} onClick={() => insert(value, true)}>{value}</button>
              ))}
              <button type="button" onClick={() => insert('π')} aria-label="Pi">π</button>
              <button type="button" onClick={() => insert('e')} aria-label="Euler’s number">e</button>
              <button type="button" onClick={() => insert('^')} aria-label="Power">^</button>
              <button type="button" onClick={() => insert('!')} aria-label="Factorial">!</button>
            </div>
          )}
          <div className="calculator-keys" role="group" aria-label="Calculator keypad">
            <button type="button" className="calculator-wide" onClick={() => change('', 0)}>Clear</button>
            <button type="button" className="calculator-wide" onClick={backspace}>Backspace</button>
            {basicKeys.map(([value, label]) => (
              <button key={value} type={value === '=' ? 'submit' : 'button'} aria-label={label ?? (value === '=' ? 'Equals' : undefined)}
                className={value === '=' ? 'calculator-equals' : undefined}
                onClick={value === '=' ? undefined : () => insert(value)}>{value}</button>
            ))}
          </div>
        </div>
      </form>
      <button className="text-button calculator-web" onClick={() => onSearchWeb(expression.trim() || initialExpression)}>Search the web</button>
    </section>
  )
}
