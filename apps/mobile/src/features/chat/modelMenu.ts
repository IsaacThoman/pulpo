import { orderedModelsById, resolveVisibleOrder } from './modelPreferences'

export const FAVORITES_SECTION = '__favorites__'
type MenuModel = { id: string; providerGroupId: string; lab: string }

/** Shared section membership and ordering for both native menu presentations. */
export function resolveModelMenu<T extends MenuModel>(models: T[], favoriteIds: string[], providerOrder: string[], requestedSection: string) {
  const providerIds = [...new Set(models.map((model) => model.providerGroupId))]
  const sections = [
    { id: FAVORITES_SECTION, label: 'Favorites' },
    ...resolveVisibleOrder(providerOrder, providerIds).map((id) => ({ id, label: models.find((model) => model.providerGroupId === id)!.lab })),
  ]
  const section = sections.some((candidate) => candidate.id === requestedSection) ? requestedSection : FAVORITES_SECTION
  const visibleModels = section === FAVORITES_SECTION
    ? orderedModelsById(models, [...new Set(favoriteIds)])
    : models.filter((model) => model.providerGroupId === section)
  return { sections, section, sectionLabel: sections.find((candidate) => candidate.id === section)!.label, visibleModels }
}
