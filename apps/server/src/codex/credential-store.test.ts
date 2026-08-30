import { describe, expect, it } from 'vitest'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { codexPlanType, isSupportedCodexPlan, safeCodexErrorMessage } from './credential-store.js'

function oauthWithClaims(claims: Record<string, unknown>): OAuthCredential {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return { type: 'oauth', access: `${header}.${payload}.signature`, refresh: 'never-expose-me', expires: Date.now() + 60_000 }
}

describe('Codex plan handling', () => {
  it.each(['plus', 'pro'])('accepts an explicit %s entitlement', (plan) => {
    const credential = oauthWithClaims({ 'https://api.openai.com/auth.chatgpt_plan_type': plan })
    expect(codexPlanType(credential)).toBe(plan)
    expect(isSupportedCodexPlan(codexPlanType(credential))).toBe(true)
  })

  it('accepts a missing entitlement as unknown for upstream verification', () => {
    expect(codexPlanType(oauthWithClaims({ sub: 'account' }))).toBe('unknown')
    expect(isSupportedCodexPlan('unknown')).toBe(true)
  })

  it.each(['free', 'team', 'enterprise'])('rejects an explicitly unsupported %s entitlement', (plan) => {
    expect(isSupportedCodexPlan(plan)).toBe(false)
  })

  it('does not include OAuth secrets in derived metadata', () => {
    const credential = oauthWithClaims({ 'https://api.openai.com/auth.chatgpt_plan_type': 'plus', account_id: 'secret-account' })
    const metadata = { planType: codexPlanType(credential), status: 'connected' }
    expect(JSON.stringify(metadata)).not.toContain(credential.refresh)
    expect(JSON.stringify(metadata)).not.toContain('secret-account')
  })

  it('redacts upstream authentication and account details from persisted errors', () => {
    const message = safeCodexErrorMessage(new Error('401 token access-secret account acct-secret'))
    expect(message).toBe('Codex authentication failed. Reconnect in Settings.')
    expect(message).not.toContain('access-secret')
    expect(message).not.toContain('acct-secret')
  })
})
