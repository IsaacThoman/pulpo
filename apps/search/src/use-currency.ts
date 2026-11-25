import { useEffect, useState } from 'react'
import { api } from './api'
import type { CurrencyQuery, CurrencyResponse } from './currency'

export function useCurrencyQuote(query: CurrencyQuery | undefined, userId: string | undefined) {
  const { amount, from, to } = query ?? {}
  const [current, setCurrent] = useState<{ key: string; result: CurrencyResponse | null }>()
  const key = amount && from && to && userId ? [userId, amount, from, to].join(':') : undefined
  useEffect(() => {
    if (!key || !amount || !from || !to) return
    const controller = new AbortController()
    api.currency({ amount, from, to }, controller.signal).then(result => {
      if (!controller.signal.aborted) setCurrent({ key, result })
    }).catch(() => {
      if (!controller.signal.aborted) setCurrent({ key, result: null })
    })
    return () => controller.abort()
  }, [amount, from, key, to])
  return current?.key === key ? current?.result : undefined
}
