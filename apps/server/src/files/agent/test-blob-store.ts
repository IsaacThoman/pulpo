import { Readable } from 'node:stream'

/** An object store in a Map, for tests that mock `storage/index.js`. */
export function memoryBlobStore(objects: Map<string, Buffer>) {
  const read = (key: string) => {
    const body = objects.get(key)
    if (!body) throw new Error(`Missing object ${key}`)
    return body
  }
  return {
    put: async (key: string, body: Uint8Array) => { objects.set(key, Buffer.from(body)) },
    get: async (key: string) => read(key),
    getStream: async (key: string) => Readable.from([read(key)]),
    delete: async (key: string) => { objects.delete(key) },
    copy: async (source: string, target: string) => { objects.set(target, read(source)) },
  }
}
