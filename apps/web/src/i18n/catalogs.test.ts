import { afterEach, describe, expect, it } from 'vitest'
import i18n from './index'
import enUS from './locales/en-US'
import esES from './locales/es-ES'

function keys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') return [prefix]
  return Object.entries(value)
    .flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key))
    .sort()
}

describe('translation catalogs', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('keeps English and Spanish keys in sync', () => {
    expect(keys(esES)).toEqual(keys(enUS))
  })

  it('switches visible copy and interpolates values', async () => {
    expect(i18n.t('auth.welcomeBack')).toBe('Welcome back')

    await i18n.changeLanguage('es-ES')

    expect(i18n.t('auth.welcomeBack')).toBe('Te damos la bienvenida')
    expect(i18n.t('auth.inviteCodeCharacter', { number: 3 })).toBe('Carácter 3 del código de invitación')
  })
})
