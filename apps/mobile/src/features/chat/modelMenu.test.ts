import { describe, expect, it } from 'vitest'
import { FAVORITES_SECTION, resolveModelMenu } from './modelMenu'
const models = Array.from({ length: 12 }, (_, i) => ({ id: String(i), providerGroupId: i < 8 ? 'lab-a' : 'lab-b', lab: i < 8 ? 'Lab A' : 'Lab B' }))
describe('shared native model menu', () => {
  it('shows all ordered favorites without inserting the current model or arbitrary alternatives', () => {
    const ids = ['11', '8', '7', '5', '3', '1', '0']
    expect(resolveModelMenu(models, [...ids, 'missing', '11'], [], FAVORITES_SECTION).visibleModels.map(m => m.id)).toEqual(ids)
    expect(resolveModelMenu(models, [], [], FAVORITES_SECTION).visibleModels).toEqual([])
  })
  it('honors provider order and exposes every model in the selected lab', () => {
    const menu = resolveModelMenu(models, [], ['lab-b', 'missing', 'lab-a'], 'lab-a')
    expect(menu.sections.map(s => s.id)).toEqual([FAVORITES_SECTION, 'lab-b', 'lab-a'])
    expect(menu.sectionLabel).toBe('Lab A')
    expect(menu.visibleModels.map(m => m.id)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7'])
  })
  it('returns to Favorites when a lab disappears and distinguishes labs with identical names', () => {
    expect(resolveModelMenu(models, ['11'], [], 'removed').visibleModels.map(m => m.id)).toEqual(['11'])
    const sameNames = models.map(m => ({ ...m, lab: 'Shared name' }))
    expect(resolveModelMenu(sameNames, [], [], 'lab-b').visibleModels.map(m => m.id)).toEqual(['8', '9', '10', '11'])
  })
})
