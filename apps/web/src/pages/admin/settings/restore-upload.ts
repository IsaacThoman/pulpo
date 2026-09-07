import { ApiError, apiRequest } from '@/lib/api'
import { isDesktopRuntime, runtimeApiUrl, runtimeAuthorizationHeaders, runtimeInstanceUrl } from '@/lib/runtime'

export interface RestoreUploadSession {
  id: string
  chunkSize: number
  status: string
  parts: Record<string, { size: number; checksum: string }>
  job: { status: string; progress: number; error: string | null } | null
}
const endpoint = '/api/admin/restore/uploads'
const MAX_SIZE = 20 * 1024 ** 3
const digest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  (value) => value.toString(16).padStart(2, '0')).join('')

export async function restoreFingerprint(file: File): Promise<string> {
  // This finds the session quickly. Every previously acknowledged chunk is
  // hashed again before it is skipped, so matching samples alone cannot mix files.
  const sample = new Blob([JSON.stringify([file.name, file.size, file.lastModified]), file.slice(0, 64 * 1024), file.slice(-64 * 1024)])
  return digest(await sample.arrayBuffer())
}

function storageKey(userId: string, fingerprint: string) {
  return `pulpo:restore-upload:${runtimeInstanceUrl()}:${userId}:${fingerprint}`
}
function savedId(key: string) { try { return localStorage.getItem(key) } catch { return null } }
function remember(key: string, value: string) { try { localStorage.setItem(key, value) } catch { /* In-tab retries still work when storage is unavailable. */ } }

export function waitForRestoreRetry(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Upload paused', 'AbortError')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

async function retry<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    try { return await operation() } catch (error) {
      if (signal.aborted || attempt >= 3 || !(error instanceof TypeError || (error instanceof ApiError && (error.status === 0 || error.status === 429 || error.status >= 500)))) throw error
      await waitForRestoreRetry(error instanceof ApiError && error.status === 429 ? 60_000 : 1000 * 2 ** attempt, signal)
    }
  }
}

export function uploadRestoreChunk(path: string, body: Blob, checksum: string, onProgress: (bytes: number) => void, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const fail = (error: Error) => { signal.removeEventListener('abort', abort); reject(error) }
    xhr.open('PUT', runtimeApiUrl(path))
    xhr.withCredentials = !isDesktopRuntime()
    xhr.timeout = 5 * 60 * 1000
    for (const [key, value] of Object.entries(runtimeAuthorizationHeaders(path))) xhr.setRequestHeader(key, value)
    xhr.setRequestHeader('x-chunk-sha256', checksum)
    xhr.upload.onprogress = (event) => onProgress(event.lengthComputable ? Math.min(body.size, body.size * event.loaded / event.total) : 0)
    xhr.onerror = () => fail(new ApiError(0, 'upload_network_error', 'Upload interrupted. Check your connection and resume.'))
    xhr.ontimeout = () => fail(new ApiError(0, 'upload_timeout', 'Upload timed out. Resume to retry the remaining chunks.'))
    xhr.onabort = () => fail(new DOMException('Upload paused', 'AbortError'))
    xhr.onload = () => {
      signal.removeEventListener('abort', abort)
      if (xhr.status >= 200 && xhr.status < 300) { onProgress(body.size); resolve(); return }
      let message = xhr.status === 413 ? 'The server rejected this upload chunk as too large.' : `Upload failed (${xhr.status}). Resume to retry.`
      try { message = JSON.parse(xhr.responseText)?.error?.message ?? message } catch { /* Proxy errors may be HTML. */ }
      reject(new ApiError(xhr.status, 'upload_failed', message))
    }
    signal.addEventListener('abort', abort, { once: true })
    const form = new FormData(); form.append('file', body, 'chunk')
    xhr.send(form)
  })
}

export async function uploadRestoreBackup(file: File, userId: string, options: {
  signal: AbortSignal
  onProgress: (bytes: number) => void
  onSession: (id: string) => void
  onFinalizing: () => void
}, transport = uploadRestoreChunk): Promise<string> {
  if (!file.size || file.size > MAX_SIZE) throw new Error('Choose a backup between 1 byte and 20 GiB.')
  if (new TextDecoder().decode(await file.slice(0, 24).arrayBuffer()).startsWith('age-encryption.org/v1')) {
    throw new Error('Decrypt the .age backup locally, then select the .tar.gz file.')
  }
  const fingerprint = await restoreFingerprint(file)
  const key = storageKey(userId, fingerprint)
  let id = savedId(key) ?? crypto.randomUUID()
  remember(key, id)
  const start = () => retry(() => apiRequest<RestoreUploadSession>(endpoint, { method: 'POST', signal: options.signal,
    body: { id, originalName: file.name, sizeBytes: file.size, fingerprint } }), options.signal)
  let session: RestoreUploadSession
  try { session = await start() } catch (error) {
    if (!(error instanceof ApiError) || ![404, 410].includes(error.status)) throw error
    id = crypto.randomUUID(); remember(key, id); session = await start()
  }
  options.onSession(id)
  if (session.status !== 'uploading') {
    options.onFinalizing()
    if (session.status === 'queued') await retry(() => apiRequest(`${endpoint}/${id}/complete`, { method: 'POST', body: { confirmation: 'RESTORE' }, signal: options.signal }), options.signal)
    return id
  }
  if (!Number.isSafeInteger(session.chunkSize) || session.chunkSize <= 0 || session.chunkSize > 16 * 1024 ** 2) throw new Error('Server returned an invalid chunk size')
  const count = Math.ceil(file.size / session.chunkSize)
  const progress = new Map<number, number>()
  const report = (index: number, bytes: number) => {
    progress.set(index, bytes)
    options.onProgress([...progress.values()].reduce((total, value) => total + value, 0))
  }
  // One controller cancels the sibling worker when either fails. Do not leave
  // an old request racing a subsequent resume/discard action.
  const controller = new AbortController()
  const abort = () => controller.abort()
  options.signal.addEventListener('abort', abort, { once: true })
  if (options.signal.aborted) controller.abort()
  let next = 0
  const worker = async () => {
    while (next < count) {
      controller.signal.throwIfAborted()
      const index = next++
      const part = file.slice(index * session.chunkSize, Math.min(file.size, (index + 1) * session.chunkSize))
      const checksum = await digest(await part.arrayBuffer())
      const previous = session.parts[index]
      if (previous) {
        if (previous.size !== part.size || previous.checksum !== checksum) throw new Error('The selected file differs from the interrupted upload. Discard it and start again.')
        report(index, part.size); continue
      }
      await retry(() => {
        report(index, 0)
        return transport(`${endpoint}/${id}/parts/${index}`, part, checksum, (bytes) => report(index, bytes), controller.signal)
      }, controller.signal)
      report(index, part.size)
    }
  }
  let failure: unknown
  const run = () => worker().catch((error: unknown) => { failure ??= error; controller.abort() })
  try {
    await Promise.all([run(), run()])
    if (failure) throw failure
    options.signal.throwIfAborted()
    options.onFinalizing()
    await retry(() => apiRequest(`${endpoint}/${id}/complete`, { method: 'POST', body: { confirmation: 'RESTORE' }, signal: options.signal }), options.signal)
    return id
  } finally { options.signal.removeEventListener('abort', abort) }
}

export async function discardRestoreBackup(id: string, file: File, userId: string): Promise<void> {
  await apiRequest(`${endpoint}/${id}`, { method: 'DELETE' })
  try { localStorage.removeItem(storageKey(userId, await restoreFingerprint(file))) } catch { /* Optional browser persistence. */ }
}

export const readRestoreProgress = (id: string, signal: AbortSignal) => apiRequest<RestoreUploadSession>(`${endpoint}/${id}`, { signal })
