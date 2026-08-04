import {
  applyResponseEventToSnapshot,
  mergeResponseSnapshots,
  type ChatPreset,
  type ResponseEvent,
  type ResponseSnapshot,
} from '@pulpo/contracts'

export interface ChatTreeNode {
  id: string
  parentResponseId: string | null
}

export function lineageFromLeaf<T extends ChatTreeNode>(nodes: T[], leafId: string | null): T[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const lineage: T[] = []
  const seen = new Set<string>()
  let cursor = leafId
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const node = byId.get(cursor)
    if (!node) break
    lineage.unshift(node)
    cursor = node.parentResponseId
  }
  return lineage
}

export function newestDescendantId<T extends ChatTreeNode>(nodes: T[], selectedId: string): string {
  let leafId = selectedId
  for (;;) {
    const children = nodes.filter((node) => node.parentResponseId === leafId)
    const newest = children.at(-1)
    if (!newest) return leafId
    leafId = newest.id
  }
}

export function reconcileResponseEvents(
  snapshot: ResponseSnapshot,
  events: ResponseEvent[],
  authoritative?: ResponseSnapshot,
): ResponseSnapshot {
  const next = [...events]
    .sort((left, right) => left.sequence - right.sequence)
    .reduce(applyResponseEventToSnapshot, snapshot)
  return authoritative ? mergeResponseSnapshots(next, authoritative) : next
}

export type PresetResolutionErrorCode = 'model_unavailable' | 'conflicting_redirects' | 'redirect_cycle'

export class PresetResolutionError extends Error {
  constructor(readonly code: PresetResolutionErrorCode, message: string) {
    super(message)
  }
}

export interface PresetResolutionModel {
  id: string
  enabled: boolean
  allowedParameters: string[]
  presets: ChatPreset[]
}

export interface ResolvedPresetActions {
  effectiveModelId: string
  parameters: Record<string, unknown>
  selections: Record<string, string>
}

const RESERVED_PARAMETERS = new Set(['model', 'input', 'stream', 'store', 'metadata'])

export async function resolvePresetActions(
  requestedModelId: string,
  requestedSelections: Record<string, string>,
  loadModel: (modelId: string) => Promise<PresetResolutionModel | undefined>,
): Promise<ResolvedPresetActions> {
  const visited = new Set<string>()
  const parameters: Record<string, unknown> = {}
  const selections = { ...requestedSelections }
  let currentId = requestedModelId
  let initial = true

  while (!visited.has(currentId)) {
    visited.add(currentId)
    const current = await loadModel(currentId)
    if (!current?.enabled) throw new PresetResolutionError('model_unavailable', 'The selected model is unavailable')
    const redirects = new Set<string>()
    for (const preset of current.presets) {
      const requestedChoice = preset.choices.find((choice) => choice.id === selections[preset.id])
      const choice = requestedChoice ?? (initial
        ? preset.choices.find((candidate) => candidate.id === preset.defaultChoiceId) ?? preset.choices[0]
        : undefined)
      if (!choice) continue
      selections[preset.id] = choice.id
      if (choice.action.type === 'params') Object.assign(parameters, choice.action.params)
      if (choice.action.type === 'redirect') redirects.add(choice.action.modelId)
    }
    if (redirects.size === 0) {
      const allowed = new Set(current.allowedParameters)
      return {
        effectiveModelId: current.id,
        parameters: Object.fromEntries(Object.entries(parameters)
          .filter(([key]) => allowed.has(key) && !RESERVED_PARAMETERS.has(key))),
        selections,
      }
    }
    if (redirects.size > 1) {
      throw new PresetResolutionError('conflicting_redirects', 'Preset choices redirect to different models')
    }
    currentId = [...redirects][0]!
    initial = false
  }
  throw new PresetResolutionError('redirect_cycle', 'Preset redirects contain a cycle')
}

export function normalizeInstanceUrl(value: string, allowLocalhost = false): string {
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`
  const url = new URL(withScheme)
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !(allowLocalhost && local && url.protocol === 'http:')) {
    throw new Error('Pulpo instances must use HTTPS')
  }
  if (url.username || url.password || url.search || url.hash) throw new Error('Enter the instance origin only')
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url.origin + (url.pathname === '/' ? '' : url.pathname)
}

const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.txt', '.md', '.csv', '.json', '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
])

export interface AttachmentCandidate {
  name: string
  mimeType: string
  sizeBytes: number
}

export function attachmentValidationError(candidate: AttachmentCandidate): string | null {
  if (!candidate.name.trim()) return 'Attachment name is required'
  if (!Number.isFinite(candidate.sizeBytes) || candidate.sizeBytes <= 0) return 'Attachment is empty'
  if (candidate.sizeBytes > 25 * 1024 * 1024) return 'Attachment exceeds the 25 MB limit'
  if (['text/html', 'image/svg+xml'].includes(candidate.mimeType.toLowerCase())) return 'This file type is not supported'
  const dot = candidate.name.lastIndexOf('.')
  if (dot < 0 || !SUPPORTED_EXTENSIONS.has(candidate.name.slice(dot).toLowerCase())) return 'This file type is not supported'
  return null
}
