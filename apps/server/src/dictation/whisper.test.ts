import { describe, expect, it, vi } from 'vitest'
import { transcribeWithWhisper } from './whisper.js'

const connection = { url: 'https://whisper.example.ts.net:8465', token: 'service-token' }
const id = '11111111-1111-4111-8111-111111111111'

describe('self-hosted Whisper adapter', () => {
  it('authenticates upload and polling, and converts timestamps while preserving decoded duration', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ stage: 'decoding' }))
      .mockResolvedValueOnce(Response.json({
        stage: 'done',
        result: { text: ' Recording ', durationSeconds: 12.3, segments: [{ t0Ms: 1200, t1Ms: 2500, text: ' Recording ' }] },
      }))
    const audio = Uint8Array.of(9, 1, 2, 9).subarray(1, 3)
    const signal = AbortSignal.timeout(5000)
    await expect(transcribeWithWhisper({ audio, connection, fetchImpl, signal })).resolves.toEqual({
      text: 'Recording', durationSeconds: 12.3, segments: [{ start: 1.2, end: 2.5, text: 'Recording' }],
    })
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(`${connection.url}/api/pulpo/jobs`)
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST', redirect: 'error', signal,
      headers: { authorization: 'Bearer service-token', 'content-type': 'application/octet-stream' },
    })
    expect(new Uint8Array(fetchImpl.mock.calls[0]?.[1]?.body as ArrayBuffer)).toEqual(audio)
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(`${connection.url}/api/pulpo/jobs/${id}`)
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({ headers: { authorization: 'Bearer service-token' }, redirect: 'error', signal })
  })

  it('rejects a malformed identifier without polling or sending the token elsewhere', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: '//elsewhere.example' }, { status: 202 }))
    await expect(transcribeWithWhisper({
      audio: Uint8Array.of(1), connection, fetchImpl, signal: AbortSignal.timeout(5000),
    })).rejects.toMatchObject({ status: 502 })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('stops polling when the request is cancelled', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id }, { status: 202 }))
      .mockImplementationOnce(async () => {
        controller.abort()
        return Response.json({ stage: 'transcribing' })
      })
    await expect(transcribeWithWhisper({
      audio: Uint8Array.of(1), connection, fetchImpl, signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
