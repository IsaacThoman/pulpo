import { describe, expect, it } from 'vitest'
import { parseCurrencyQuery } from './currency'

describe('currency conversion queries', () => {
  it.each([
    ['100 USD to EUR', '100', 'USD', 'EUR'],
    ['convert usd 100.50 to eur?', '100.50', 'USD', 'EUR'],
    ['1,250.10 euros in Japanese yen', '1250.10', 'EUR', 'JPY'],
    ['-000.50 GBP to USD', '-0.50', 'GBP', 'USD'],
    ['€0.25 to ₹', '0.25', 'EUR', 'INR'],
    ['.50 Swiss francs to us dollars', '0.50', 'CHF', 'USD'],
    ['CHF in AUD', '1', 'CHF', 'AUD'],
    ['500GBP to DKK', '500', 'GBP', 'DKK'],
    ['194.123456 CAD to GBP', '194.123456', 'CAD', 'GBP'],
  ])('parses %s', (query, amount, from, to) => {
    expect(parseCurrencyQuery(query)).toEqual({ amount, from, to })
  })

  it.each([
    '100 dollars to pesos', '$100 to EUR', '100 EUR to flights', 'buy EUR to USD', '100 EUR to USD history', 'abc to xyz',
    '100 EUR to BTC', '100 RUPEES to INR', '100 RUB to EUR', '1,25 EUR to USD', '1e3 USD to EUR',
    '1000000000000 USD to EUR', '0.1234567 EUR to USD', '5 ft to m', '43..5 EUR to USD', '1,234, EUR to USD',
  ])('lets normal search handle %s', query => {
    expect(parseCurrencyQuery(query)).toBeUndefined()
  })
})
