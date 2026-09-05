/** Keep quick switching short; the searchable catalog contains every model. */
export function quickModelChoices<T extends { id: string }>(models: T[], selectedId: string, favorites: string[], limit = 5): T[] {
  const byId = new Map(models.map((model) => [model.id, model]));
  const ids = [...new Set([selectedId, ...favorites, ...models.map((model) => model.id)])];
  return ids.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []).slice(0, limit);
}

export function androidDialogBodyHeight(availableHeight: number, desiredHeight: number, fontScale: number): number {
  // Leave room for the title, buttons, padding, and system bars in landscape
  // and when the keyboard takes most of a compact display.
  const chromeHeight = 176 + Math.max(0, fontScale - 1) * 48;
  return Math.max(72, Math.min(desiredHeight, 440, availableHeight - chromeHeight));
}
