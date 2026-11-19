import { createHash } from 'node:crypto'
import type { DesktopStoredSession } from '../globals'
import type { ComputerAccount } from './grants'

/**
 * Who is signed in, as the main process knows it. The stored session holds the instance and a
 * bearer token but not the account id, so the id is asked of the instance once per token
 * (`GET /api/mobile/me`) and remembered for that token. The renderer is never asked.
 */

export interface AccountResolverOptions {
  loadSession: () => Promise<DesktopStoredSession | null>
  /** The account id the instance reports for this token, or null when the token is not accepted. */
  fetchUserId: (origin: string, token: string) => Promise<string | null>
}

function tokenKey(origin: string, token: string): string {
  return createHash('sha256').update(`${origin}\0${token}`).digest('hex')
}

export class AccountResolver {
  private readonly userIds = new Map<string, Promise<string | null>>()

  constructor(private readonly options: AccountResolverOptions) {}

  /**
   * The signed-in account together with the sign-in it was read from, or null when nobody is signed
   * in or the instance did not say who the token belongs to. Both come from one read of the stored
   * session, so they always belong together even when the session changes while the instance is asked.
   */
  async identity(): Promise<{ account: ComputerAccount; signIn: string } | null> {
    const session = await this.options.loadSession()
    if (!session) return null
    const key = tokenKey(session.instanceUrl, session.token)
    let pending = this.userIds.get(key)
    if (!pending) {
      pending = this.options.fetchUserId(session.instanceUrl, session.token).catch(() => null)
      this.userIds.set(key, pending)
    }
    const userId = await pending
    // A failure (offline, server down) is not remembered, so the next call asks again.
    if (!userId) { if (this.userIds.get(key) === pending) this.userIds.delete(key); return null }
    return { account: { origin: session.instanceUrl, userId }, signIn: key }
  }

  async current(): Promise<ComputerAccount | null> {
    return (await this.identity())?.account ?? null
  }

  /**
   * Identifies the stored sign-in (instance and token) without asking the instance, or null when
   * nobody is signed in. A computer session belongs to the sign-in it was begun under.
   */
  async signIn(): Promise<string | null> {
    const session = await this.options.loadSession()
    return session ? tokenKey(session.instanceUrl, session.token) : null
  }

  /** The session changed; tokens that are gone should not keep their ids. */
  forget(): void { this.userIds.clear() }
}

/** `GET /api/mobile/me` answers `{ user: { id } }` for a valid bearer token. */
export function userIdFromMe(body: unknown): string | null {
  const id = (body as { user?: { id?: unknown } } | null)?.user?.id
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : null
}
