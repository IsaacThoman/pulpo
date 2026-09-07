import { afterEach, describe, expect, it } from 'vitest'
import { configureDataProfile, dataProfileGeneration, dataProfileHeaders, dataProfileResourceUrl, dataProfileScope, dataProfileSuffix } from './data-profile.js'

afterEach(() => configureDataProfile(undefined))
describe('client profile scope', () => {
  it('retains the legacy Personal namespace and isolates other profiles and accounts', () => {
    configureDataProfile({ instance: 'https://pulpo.test', userId: 'owner', profileId: 'owner' })
    expect(dataProfileSuffix('owner')).toBe('')
    configureDataProfile({ instance: 'https://pulpo.test', userId: 'owner', profileId: 'work' })
    expect(dataProfileSuffix('owner')).toBe('|profile:work')
    expect(dataProfileSuffix('other-account')).toBe('')
    expect(dataProfileHeaders()).toEqual({ 'X-Pulpo-Profile-Id': 'work' })
  })
  it('invalidates callbacks even after rapidly switching back to the original scope', () => {
    const input = { instance: 'https://pulpo.test', userId: 'owner', profileId: 'personal' }
    configureDataProfile(input)
    const original = dataProfileGeneration()
    input.profileId = 'mutated'
    expect(dataProfileScope()?.profileId).toBe('personal')
    configureDataProfile({ ...input, profileId: 'work' })
    configureDataProfile({ ...input, profileId: 'personal' })
    expect(dataProfileGeneration()).toBe(original + 2)
    expect(Object.isFrozen(dataProfileScope())).toBe(true)
  })
  it('carries selection on authenticated media URLs without disclosing it externally', () => {
    configureDataProfile({ instance: 'https://pulpo.test', userId: 'owner', profileId: 'work' })
    expect(dataProfileResourceUrl('/api/attachments/a/download?size=small', 'https://pulpo.test')).toBe('/api/attachments/a/download?size=small&profileId=work')
    for (const url of ['https://external.test/file', 'blob:local', 'data:image/png;base64,a', 'file:///tmp/a']) expect(dataProfileResourceUrl(url, 'https://pulpo.test')).toBe(url)
  })
})
