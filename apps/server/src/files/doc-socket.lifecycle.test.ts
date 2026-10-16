import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { DOC_SCHEMA_VERSION } from '@pulpo/client-core/doc-schema'

vi.mock('./doc-store.js', () => ({ appendDocUpdate: vi.fn(), loadDocUpdate: vi.fn(), MAX_DOC_UPDATE_BYTES: 1_000_000 }))
vi.mock('./request.js', () => ({ filesFeatureEnabled: vi.fn() }))
vi.mock('./access.js', () => ({ resolveFileAccess: vi.fn() }))
vi.mock('../database/client.js', () => ({ db: {} }))

const { appendDocUpdate, loadDocUpdate } = await import('./doc-store.js')
const { filesFeatureEnabled } = await import('./request.js')
const { resolveFileAccess } = await import('./access.js')
const { bindDocSocket, docRoom } = await import('./doc-socket.js')
const docId = 'abcdefab-0000-4000-8000-000000000001'

function socketFixture() {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const socket = {
    connected: true,
    data: { user: { id: 'owner' }, actorUser: { id: 'owner' } },
    rooms: new Set<string>(),
    on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
    join: vi.fn(async (room: string) => { socket.rooms.add(room) }),
    leave: vi.fn(async (room: string) => { socket.rooms.delete(room) }),
    to: () => ({ emit: vi.fn(), volatile: { emit: vi.fn() } }),
  }
  bindDocSocket(socket as unknown as Parameters<typeof bindDocSocket>[0])
  return {
    socket,
    emit: (event: string, data?: unknown) => handlers.get(event)!(data),
    request: (event: string, data: unknown) => new Promise<unknown>((resolve) => handlers.get(event)!(data, resolve)),
    join: (requestedId = docId) => new Promise<unknown>((resolve) => handlers.get('doc.join')!({
      docId: requestedId, stateVector: Y.encodeStateVector(new Y.Doc()), awarenessClientId: 1, schemaVersion: DOC_SCHEMA_VERSION,
    }, resolve)),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(filesFeatureEnabled).mockResolvedValue(true)
  vi.mocked(resolveFileAccess).mockResolvedValue({ role: 'owner', node: { id: docId, kind: 'doc', trashedAt: null } } as Awaited<ReturnType<typeof resolveFileAccess>>)
  vi.mocked(loadDocUpdate).mockResolvedValue(Y.encodeStateAsUpdate(new Y.Doc()))
  vi.mocked(appendDocUpdate).mockResolvedValue(undefined)
})

describe('document socket lifecycle', () => {
  it('uses the canonical UUID room for mixed-case joins, writes, and leaves', async () => {
    const fixture = socketFixture()
    expect(await fixture.join(docId.toUpperCase())).toMatchObject({ ok: true })
    expect(fixture.socket.rooms).toEqual(new Set([docRoom(docId)]))
    expect(await fixture.request('doc.update', { docId: docId.toUpperCase(), update: new Uint8Array([0, 0]) })).toMatchObject({ ok: true })
    expect(appendDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ nodeId: docId, ownerUserId: 'owner' }))
    fixture.emit('doc.leave', { docId: docId.toUpperCase() })
    expect(fixture.socket.rooms.size).toBe(0)
  })

  it('drops an earlier membership when a rejoin is denied', async () => {
    const fixture = socketFixture()
    expect(await fixture.join()).toMatchObject({ ok: true })
    vi.mocked(filesFeatureEnabled).mockResolvedValue(false)
    expect(await fixture.join()).toMatchObject({ ok: false, error: 'unauthorized' })
    expect(fixture.socket.rooms.size).toBe(0)
  })
  it('cancels a join when the editor leaves while its document is loading', async () => {
    const fixture = socketFixture()
    let finish!: (update: Uint8Array) => void
    vi.mocked(loadDocUpdate).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const joining = fixture.join()
    await vi.waitFor(() => expect(loadDocUpdate).toHaveBeenCalled())
    fixture.emit('doc.leave', { docId })
    finish(Y.encodeStateAsUpdate(new Y.Doc()))
    expect(await joining).toMatchObject({ ok: false })
    expect(fixture.socket.rooms.has(docRoom(docId))).toBe(false)
  })

  it('does not join after disconnecting during the access check', async () => {
    const fixture = socketFixture()
    let finish!: (enabled: boolean) => void
    vi.mocked(filesFeatureEnabled).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const joining = fixture.join()
    fixture.socket.connected = false
    fixture.emit('disconnecting')
    finish(true)
    expect(await joining).toMatchObject({ ok: false })
    expect(fixture.socket.join).not.toHaveBeenCalled()
  })

  it('rechecks Files being disabled for an already joined socket', async () => {
    const fixture = socketFixture()
    expect(await fixture.join()).toMatchObject({ ok: true })
    vi.mocked(filesFeatureEnabled).mockResolvedValue(false)
    expect(await fixture.request('doc.update', { docId, update: new Uint8Array([0, 0]) })).toMatchObject({ ok: false, error: 'unauthorized' })
    expect(appendDocUpdate).not.toHaveBeenCalled()
  })

  it('drops room membership after a failed join instead of relaying further document updates', async () => {
    const fixture = socketFixture()
    vi.mocked(loadDocUpdate).mockRejectedValueOnce(new Error('failed read'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await fixture.join()).toMatchObject({ ok: false })
      expect(fixture.socket.rooms.has(docRoom(docId))).toBe(false)
    } finally { error.mockRestore() }
  })
})
