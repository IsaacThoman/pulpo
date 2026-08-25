import { afterEach, describe, expect, it } from 'vitest'
import i18n from './index'
import { activeLocale, ui, uit } from './ui'

describe('source-keyed UI translations', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('uses English source copy by default', () => {
    expect(ui('Billing')).toBe('Billing')
    expect(activeLocale()).toBe('en-US')
  })

  it('translates static and dynamic Spanish copy', async () => {
    await i18n.changeLanguage('es-ES')

    expect(ui('Billing')).toBe('Facturación')
    expect(uit`Retry ${3}`).toBe('Reintentar 3')
    expect(activeLocale()).toBe('es-ES')
  })
})
