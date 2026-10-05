/**
 * Adds items to a chat's Files scope once each. A folder and items inside it can both be in the
 * scope: the items tell the agent what the user pointed out.
 */
export function addFileScope(ids: readonly string[], added: readonly string[]): string[] {
  return [...new Set([...ids, ...added])]
}
