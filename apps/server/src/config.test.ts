import { describe, expect, it } from 'vitest'
import { parseConfig } from './config.js'

describe('server configuration', () => {
  it('treats empty optional workspace controller values as unset', () => {
    const config = parseConfig({
      WORKSPACE_CONTROLLER_URL: '',
      WORKSPACE_CONTROLLER_TOKEN: '',
      WORKSPACE_CONTROLLER_CA_CERT_BASE64: '',
    })

    expect(config.WORKSPACE_CONTROLLER_URL).toBeUndefined()
    expect(config.WORKSPACE_CONTROLLER_TOKEN).toBeUndefined()
    expect(config.WORKSPACE_CONTROLLER_CA_CERT_BASE64).toBeUndefined()
  })

  it('still validates configured workspace controller values', () => {
    expect(() => parseConfig({
      WORKSPACE_CONTROLLER_URL: 'not-a-url',
      WORKSPACE_CONTROLLER_TOKEN: 'short',
    })).toThrow()
  })
})
