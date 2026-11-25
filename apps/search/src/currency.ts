export interface CurrencyQuery {
  amount: string
  from: string
  to: string
}

interface CurrencySource {
  name: string
  url: string
  description: string
}

export type CurrencyResponse = { source: CurrencySource } & (
  | ({ status: 'converted'; converted: string; rate: string; referenceDate: string } & CurrencyQuery)
  | { status: 'unsupported'; currency: string }
  | { status: 'unavailable' }
)

// Daily ECB reference rates, plus the euro base currency.
export const currencyCodes = [
  'EUR', 'USD', 'JPY', 'CZK', 'DKK', 'GBP', 'HUF', 'PLN', 'RON', 'SEK', 'CHF', 'ISK', 'NOK', 'TRY', 'AUD',
  'BRL', 'CAD', 'CNY', 'HKD', 'IDR', 'ILS', 'INR', 'KRW', 'MXN', 'MYR', 'NZD', 'PHP', 'SGD', 'THB', 'ZAR',
]
const currencies = new Set(currencyCodes)
const currencyNames = new Map([
  ['euro', 'EUR'], ['euros', 'EUR'], ['€', 'EUR'],
  ['us dollar', 'USD'], ['us dollars', 'USD'], ['u.s. dollar', 'USD'], ['u.s. dollars', 'USD'],
  ['british pound', 'GBP'], ['british pounds', 'GBP'], ['pound sterling', 'GBP'], ['pounds sterling', 'GBP'], ['£', 'GBP'],
  ['yen', 'JPY'], ['japanese yen', 'JPY'], ['yuan', 'CNY'], ['chinese yuan', 'CNY'],
  ['indian rupee', 'INR'], ['indian rupees', 'INR'], ['₹', 'INR'],
  ['australian dollar', 'AUD'], ['australian dollars', 'AUD'],
  ['canadian dollar', 'CAD'], ['canadian dollars', 'CAD'],
  ['swiss franc', 'CHF'], ['swiss francs', 'CHF'],
])

function currencyCode(label: string) {
  const value = label.trim().replace(/\s+/g, ' ')
  return currencyNames.get(value.toLowerCase()) ?? (currencies.has(value.toUpperCase()) ? value.toUpperCase() : undefined)
}

const amountToken = '[+-]?(?:\\d[\\d,]*(?:\\.\\d+)?|\\.\\d+)'
const amountFirst = new RegExp('^(' + amountToken + ')\\s*([^\\d].*)$')
const currencyFirst = new RegExp('^([a-z.€£₹ ]+?)\\s*(' + amountToken + ')$', 'i')
const validNumber = /^[+-]?(?:(?:[1-9]\d{0,2}(?:,\d{3})+|\d+)(?:\.\d{1,6})?|\.\d{1,6})$/

function normalizeAmount(input: string) {
  if (!validNumber.test(input)) return
  const negative = input.startsWith('-')
  const [whole = '', fraction] = input.replace(/^[+-]/, '').replace(/,/g, '').split('.')
  const integral = whole.replace(/^0+/, '') || '0'
  if (integral.length > 12) return
  return (negative ? '-' : '') + integral + (fraction ? '.' + fraction : '')
}

export function parseCurrencyQuery(query: string): CurrencyQuery | undefined {
  const expression = query.trim()
  if (!expression || expression.length > 120) return
  const conversion = /^(?:convert\s+)?(.+?)\s+(?:to|in)\s+(.+?)\??$/i.exec(expression)
  if (!conversion) return
  const [, input, target] = conversion
  const to = currencyCode(target)
  const leading = amountFirst.exec(input)
  const trailing = currencyFirst.exec(input)
  const from = currencyCode(leading?.[2] ?? trailing?.[1] ?? input)
  const amount = normalizeAmount(leading?.[1] ?? trailing?.[2] ?? '1')
  if (amount && from && to) return { amount, from, to }
}
