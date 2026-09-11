/** Delete moved positions before inserting to preserve the unique position constraint. */
export function composerAttachmentDelta(before: readonly { id: string }[], after: readonly { id: string }[]) {
  const oldPositions = new Map(before.map((item, position) => [item.id, position]))
  const newPositions = new Map(after.map((item, position) => [item.id, position]))
  return {
    remove: before.filter((item, position) => newPositions.get(item.id) !== position).map((item) => item.id),
    insert: after.flatMap((item, position) => oldPositions.get(item.id) === position ? [] : [{ attachmentId: item.id, position }]),
  }
}
