import { AsyncLocalStorage } from 'node:async_hooks'
import { and, eq, inArray, sql, type AnyColumn } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

export interface ProfileScope { readonly userId: string; readonly profileId: string }
const storage = new AsyncLocalStorage<ProfileScope | undefined>()
export const currentProfile = (): ProfileScope | undefined => storage.getStore()
export function withProfile<T>(scope: ProfileScope | undefined, operation: () => T): T {
  return storage.run(scope && Object.freeze({ ...scope }), () => {
    const result = operation()
    // Drizzle builders are lazy thenables. Adopt them before leaving the scope
    // so insert defaults and execution run in the same context as predicates.
    return result && typeof (result as { then?: unknown }).then === 'function' ? Promise.resolve(result) as T : result
  })
}

// SQL inserts outside a profile operation (registration, restore, maintenance)
// use the database's ownership trigger to derive the profile from their parent.
export const profileInsertDefault = () => currentProfile()?.profileId ?? sql`NULL`

export function profileCondition(column: AnyColumn) {
  const scope = currentProfile()
  return scope ? eq(column, scope.profileId) : undefined
}

function columnScope(column: unknown) {
  const table = (column as AnyPgColumn | undefined)?.table as unknown as { profileId?: AnyColumn } | undefined
  return table?.profileId ? profileCondition(table.profileId) : undefined
}

/** Profile predicates accompany resource ownership/ID predicates, including joins. */
export const profileEq: typeof eq = ((column: unknown, value: unknown) => {
  const predicate = eq(column as AnyColumn, value)
  const scope = columnScope(column)
  return scope ? and(predicate, scope)! : predicate
}) as typeof eq
export const profileInArray: typeof inArray = ((column: unknown, values: unknown) => {
  const predicate = inArray(column as AnyColumn, values as unknown[])
  const scope = columnScope(column)
  return scope ? and(predicate, scope)! : predicate
}) as typeof inArray
