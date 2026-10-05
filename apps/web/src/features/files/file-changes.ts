/** Agent tools that change Files; a reply that ran one successfully may have something to undo. */
const CHANGING_TOOLS = new Set(['files_write', 'files_edit', 'files_create_folder'])

export function changedFiles(outputItems: readonly unknown[] | undefined): boolean {
  return (outputItems ?? []).some((item) => {
    const tool = item as { type?: string; tool?: string; status?: string; isError?: boolean }
    return tool.type === 'pulpo_tool' && CHANGING_TOOLS.has(tool.tool ?? '') && tool.status === 'completed' && !tool.isError
  })
}
