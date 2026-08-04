type AsyncAction = (...args: any[]) => Promise<unknown>

type ProductionActions = {
  renameChat: AsyncAction
  togglePin: AsyncAction
  moveChat: AsyncAction
  trashChat: AsyncAction
  restoreChat: AsyncAction
  permanentlyDeleteChat: AsyncAction
  emptyTrash: AsyncAction
  duplicateChat: AsyncAction
  shareChat: AsyncAction
  createFolder: AsyncAction
  renameFolder: AsyncAction
  deleteFolder: AsyncAction
  setPreference: AsyncAction
}

const noop: AsyncAction = async () => undefined

export const productionActions: ProductionActions = {
  renameChat: noop, togglePin: noop, moveChat: noop, trashChat: noop, restoreChat: noop,
  permanentlyDeleteChat: noop, duplicateChat: noop, shareChat: noop, createFolder: noop,
  renameFolder: noop, deleteFolder: noop, emptyTrash: noop, setPreference: noop,
}

export function configureProductionActions(actions: Partial<ProductionActions>): void {
  Object.assign(productionActions, actions)
}

export function runProductionAction(action: Promise<unknown>): void {
  void action.catch((error) => console.warn('Pulpo action failed', error instanceof Error ? error.message : error))
}
