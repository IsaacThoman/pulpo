export type SignupPromoBudgetPeriod = 'hour' | 'day'

export interface SignupPromoSettings {
  enabled: boolean
  amountMicros: number
  message: string
  eligibleDays: number
  budgetMicros: number
  budgetPeriod: SignupPromoBudgetPeriod
}

export interface SignupPromoState {
  settings: SignupPromoSettings
  usage: {
    periodStartsAt: string
    resetsAt: string
    periodClaimedMicros: number
    periodClaims: number
    totalClaimedMicros: number
    totalClaims: number
  }
}

export interface SignupPromoDraft { enabled: boolean; amount: string; message: string; eligibleDays: string; budget: string; budgetPeriod: SignupPromoBudgetPeriod }

export function signupPromoDraft(settings: SignupPromoSettings): SignupPromoDraft {
  return {
    enabled: settings.enabled,
    amount: (settings.amountMicros / 1_000_000).toFixed(2),
    message: settings.message,
    eligibleDays: String(settings.eligibleDays),
    budget: (settings.budgetMicros / 1_000_000).toFixed(2),
    budgetPeriod: settings.budgetPeriod,
  }
}

/** Parses the draft, or returns null when a value is out of range. */
export function parseSignupPromoDraft(draft: SignupPromoDraft): SignupPromoSettings | null {
  const amountMicros = Math.round(Number(draft.amount) * 1_000_000)
  const budgetMicros = Math.round(Number(draft.budget) * 1_000_000)
  const eligibleDays = Number(draft.eligibleDays)
  const valid = draft.amount.trim() !== '' && Number.isFinite(amountMicros) && amountMicros > 0 && amountMicros <= 1_000_000_000
    && draft.budget.trim() !== '' && Number.isFinite(budgetMicros) && budgetMicros >= 0
    && Number.isInteger(eligibleDays) && eligibleDays >= 1 && eligibleDays <= 365
    && draft.message.trim().length <= 500
  return valid ? { enabled: draft.enabled, amountMicros, message: draft.message.trim(), eligibleDays, budgetMicros, budgetPeriod: draft.budgetPeriod } : null
}
