import { createServer, type RequestListener, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'

const config = vi.hoisted(() => ({ OFFICE_CONVERTER_URL: '', OFFICE_CONVERTER_TIMEOUT_SECONDS: 0.1 }))
vi.mock('../../config.js', () => ({ getConfig: () => config }))
const { convertOfficeDocument } = await import('./converter.js')

let server: Server
async function start(handler: RequestListener) {
  server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  config.OFFICE_CONVERTER_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})
const convert = () => convertOfficeDocument({ bytes: new Uint8Array([1]), from: 'doc', to: 'docx' })

describe('office converter response transport', () => {
  it('maps a timeout after response headers to the conversion timeout error', async () => {
    await start((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.flushHeaders()
    })
    await expect(convert()).rejects.toMatchObject({ statusCode: 504, code: 'office_conversion_timeout' })
  })

  it('maps a truncated successful response to converter unavailable', async () => {
    await start((_request, response) => {
      response.writeHead(200, { 'content-length': 100 })
      response.write('partial')
      setImmediate(() => response.destroy())
    })
    await expect(convert()).rejects.toMatchObject({ statusCode: 502, code: 'office_converter_unavailable' })
  })
})
