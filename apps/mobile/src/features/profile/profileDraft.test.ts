import { describe, expect, it } from 'vitest'
import { profileDraft } from './profileDraft'

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
  })
})
