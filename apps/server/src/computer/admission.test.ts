import { describe, expect, it } from 'vitest'
import type { ComputerSelection } from '@pulpo/contracts'
import { admitComputer, type ComputerAdmissionInput } from './admission.js'

const computer: ComputerSelection = { sessionId: '6f0c2a7e-1d6b-4c43-9a51-0d3c5b7f2a10', access: 'read', folder: '/Users/me/project' }
const allowed: ComputerAdmissionInput = { computer, agentMode: true, origin: 'web', clientFeatures: ['computer'], computerAccess: true }

describe('admitComputer', () => {
  it('admits a desktop agent request when the setting allows it', () => {
    expect(admitComputer(allowed)).toEqual(computer)
  })

  it('drops the selection silently outside Agent mode, and without one there is nothing to check', () => {
    expect(admitComputer({ ...allowed, agentMode: false, clientFeatures: [], computerAccess: false })).toBeNull()
    expect(admitComputer({ ...allowed, computer: undefined, clientFeatures: [] })).toBeNull()
    expect(admitComputer({ ...allowed, computer: null, origin: 'api' })).toBeNull()
  })

  it.each([
    ['an API request', { origin: 'api' as const }],
    ['admin chat access', { origin: 'admin_chat' as const }],
    ['an app without the bridge', { clientFeatures: ['files-permission'] }],
    ['an app that sent no features', { clientFeatures: undefined }],
    ['the setting turned off', { computerAccess: false }],
  ])('refuses %s instead of falling back to the cloud', (_name, change) => {
    expect(() => admitComputer({ ...allowed, ...change })).toThrow(expect.objectContaining({ statusCode: 400, code: 'computer_unavailable' }))
  })
})
