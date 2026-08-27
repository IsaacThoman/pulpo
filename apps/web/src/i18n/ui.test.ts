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

  it('translates completed activity and workspace status copy', async () => {
    await i18n.changeLanguage('es-ES')

    expect(ui('Worked')).toBe('Trabajó')
    expect(ui('Worked for {{duration}}', { duration: '3 segundos' })).toBe('Trabajó durante 3 segundos')
    expect(ui('Thought')).toBe('Pensó')
    expect(ui('Thought for {{duration}}', { duration: '3 segundos' })).toBe('Pensó durante 3 segundos')
    expect(ui('Waiting for workspace')).toBe('Esperando un espacio de trabajo')
    expect(ui('Waiting for workspace · queue #{{position}}', { position: 3 }))
      .toBe('Esperando un espacio de trabajo · puesto 3 en la cola')
    expect(ui('Workspace expired')).toBe('Espacio de trabajo caducado')
    expect(ui('Workspace unavailable')).toBe('Espacio de trabajo no disponible')
    expect(ui('Continuing without agent tools')).toBe('Continuando sin las herramientas del agente')
  })
})
