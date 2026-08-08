import { responseAttachmentIds } from '../messages/input.js'

export function attachmentReferenceIsLive(
  id: string,
  responseInputs: unknown[],
  queuedAttachmentIds: string[][],
): boolean {
  return responseInputs.some((input) => responseAttachmentIds(input).includes(id))
    || queuedAttachmentIds.some((ids) => ids.includes(id))
}
