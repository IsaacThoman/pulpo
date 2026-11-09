import { describe, expect, it } from 'vitest'
import { profileDraft, usageVisibilityHint, usageVisibilityOf, usageVisibilityOptions } from './profileDraft'

const user = { name: 'Isaac', username: 'isaac' }

describe('profile draft', () => {
  it('sends nothing when the fields match the account', () => {
    expect(profileDraft(user, ' Isaac ', 'isaac')).toEqual({ patch: {}, usernameError: null, canSave: true })
  })

  it('sends only the changed, normalized fields', () => {
    expect(profileDraft(user, 'Isaac T', 'isaac').patch).toEqual({ name: 'Isaac T' })
    expect(profileDraft(user, 'Isaac', '@New_Name').patch).toEqual({ username: 'new_name' })
  })

  it('explains invalid usernames with the shared rules and blocks saving', () => {
    const draft = profileDraft(user, 'Isaac T', '_isaac')
    expect(draft.usernameError).toContain('begin and end')
    expect(draft.patch).toEqual({ name: 'Isaac T' })
    expect(draft.canSave).toBe(false)
  })

  it('needs a display name and an account', () => {
    expect(profileDraft(user, '  ', 'isaac').canSave).toBe(false)
    expect(profileDraft(null, 'Isaac', 'isaac').canSave).toBe(false)
    expect(profileDraft(null, 'Isaac', 'isaac', 'public').patch).toEqual({})
  })

  it('sends the usage visibility only when it changed', () => {
    const shared = { ...user, usageVisibility: 'public' as const }
    expect(profileDraft(shared, 'Isaac', 'isaac').patch).toEqual({})
    expect(profileDraft(shared, 'Isaac', 'isaac', 'public').patch).toEqual({})
    expect(profileDraft(shared, 'Isaac T', 'isaac', 'pool').patch).toEqual({ name: 'Isaac T', usageVisibility: 'pool' })
    expect(profileDraft(shared, 'Isaac', '_isaac', 'friends')).toMatchObject({ patch: { usageVisibility: 'friends' }, canSave: false })
  })

  it('reads a cached account without the setting as visible to friends', () => {
    expect(usageVisibilityOf({})).toBe('friends')
    expect(usageVisibilityOf(null)).toBe('friends')
    expect(profileDraft(user, 'Isaac', 'isaac', 'friends').patch).toEqual({})
    expect(profileDraft(user, 'Isaac', 'isaac', 'public').patch).toEqual({ usageVisibility: 'public' })
  })
})

describe('usage visibility choices', () => {
  it('match web and mention Pools only where they exist', () => {
    expect(usageVisibilityOptions(true)).toEqual([{ value: 'pool', label: 'Private (Pool only)' }, { value: 'friends', label: 'Friends' }, { value: 'public', label: 'Public' }])
    expect(usageVisibilityOptions(false).map((option) => option.label)).toEqual(['Private', 'Friends', 'Public'])
    expect(usageVisibilityHint(true)).toBe('Who can see your usage stats and requests on your profile. Pool members can always see your usage.')
    expect(usageVisibilityHint(false)).toBe('Who can see your usage stats and requests on your profile.')
  })

  it('never mention balances, credits, or prices', () => {
    const copy = [true, false].flatMap((pools) => [usageVisibilityHint(pools), ...usageVisibilityOptions(pools).map((option) => option.label)]).join(' ')
    expect(copy).not.toMatch(/\$|credit|balance|price/i)
  })
})
