import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { Decrypter, generateHybridIdentity, generateIdentity, identityToRecipient } from 'age-encryption'
import { describe, expect, it } from 'vitest'
import { createAgeEncryptionStream, isAgeEncryptedBackup } from './backup-encryption.js'

async function bytes(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

describe('age backup encryption', () => {
  it('streams an interoperable age file and reports its exact size and checksum', async () => {
    const identity = await generateIdentity()
    const recipient = await identityToRecipient(identity)
    const plaintext = Buffer.from('pulpo backup fixture')
    const encrypted = await createAgeEncryptionStream(Readable.from([plaintext]), plaintext.byteLength, recipient)
    const ciphertext = await bytes(encrypted.body)

    expect(ciphertext.byteLength).toBe(encrypted.sizeBytes)
    expect(await encrypted.checksum).toBe(createHash('sha256').update(ciphertext).digest('hex'))
    expect(ciphertext.toString('utf8', 0, 22)).toBe('age-encryption.org/v1\n')
    expect(isAgeEncryptedBackup(ciphertext)).toBe(true)
    expect(isAgeEncryptedBackup(plaintext)).toBe(false)

    const decrypter = new Decrypter()
    decrypter.addIdentity(identity)
    await expect(decrypter.decrypt(ciphertext)).resolves.toEqual(new Uint8Array(plaintext))
  })

  it('encrypts to a post-quantum hybrid recipient without retaining its identity', async () => {
    const identity = await generateHybridIdentity()
    const recipient = await identityToRecipient(identity)
    const plaintext = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x50, 0x75, 0x6c, 0x70, 0x6f])
    const encrypted = await createAgeEncryptionStream(Readable.from([plaintext]), plaintext.byteLength, recipient)
    const ciphertext = await bytes(encrypted.body)
    expect(ciphertext.toString()).not.toContain(identity)

    const decrypter = new Decrypter()
    decrypter.addIdentity(identity)
    await expect(decrypter.decrypt(ciphertext)).resolves.toEqual(new Uint8Array(plaintext))
  })
})
