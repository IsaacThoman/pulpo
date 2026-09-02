import { createHash } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { Encrypter } from 'age-encryption'

export function isAgeEncryptedBackup(value: Uint8Array): boolean {
  return Buffer.from(value.subarray(0, 24)).toString('utf8').startsWith('age-encryption.org/v1')
}

export async function createAgeEncryptionStream(
  source: Readable,
  sourceSize: number,
  recipient: string,
): Promise<{ body: Readable; sizeBytes: number; checksum: Promise<string> }> {
  const encrypter = new Encrypter()
  encrypter.addRecipient(recipient)
  const encrypted = await encrypter.encrypt(Readable.toWeb(source) as ReadableStream<Uint8Array>)
  const hash = createHash('sha256')
  let resolveChecksum!: (value: string) => void
  const checksum = new Promise<string>((resolve) => {
    resolveChecksum = resolve
  })
  const hashingStream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    },
    flush(callback) {
      resolveChecksum(hash.digest('hex'))
      callback()
    },
  })
  return {
    body: Readable.fromWeb(encrypted as unknown as import('node:stream/web').ReadableStream).pipe(hashingStream),
    sizeBytes: encrypted.size(sourceSize),
    checksum,
  }
}
