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
  it('rejects recovery with a different private identity', async () => {
    const recipient = await identityToRecipient(await generateIdentity())
    const encrypted = await createAgeEncryptionStream(Readable.from([Buffer.from('private backup')]), 14, recipient)
    const decrypter = new Decrypter(); decrypter.addIdentity(await generateIdentity())
    await expect(decrypter.decrypt(await bytes(encrypted.body))).rejects.toThrow()
  })

  it('propagates plaintext read failures to the ciphertext consumer and checksum', async () => {
    const recipient = await identityToRecipient(await generateIdentity())
    const source = Readable.from((async function* () {
      yield Buffer.alloc(65536)
      throw new Error('backup disk read failed')
    })())
    const encrypted = await createAgeEncryptionStream(source, 131072, recipient)
    await expect(bytes(encrypted.body)).rejects.toThrow('backup disk read failed')
    await expect(encrypted.checksum).rejects.toThrow('backup disk read failed')
    expect(source.destroyed).toBe(true)
  })

  it.each([0, 65535, 65536, 65537, 131072])('round-trips %i bytes at age chunk boundaries', async (size) => {
    const identity = await generateIdentity(), recipient = await identityToRecipient(identity)
    const plaintext = Buffer.alloc(size, 23)
    const encrypted = await createAgeEncryptionStream(Readable.from([plaintext]), size, recipient)
    const ciphertext = await bytes(encrypted.body)
    expect(ciphertext.length).toBe(encrypted.sizeBytes)
    const decrypter = new Decrypter(); decrypter.addIdentity(identity)
    expect(await decrypter.decrypt(ciphertext)).toEqual(new Uint8Array(plaintext))
    ciphertext[ciphertext.length - 1]! ^= 1
    await expect(decrypter.decrypt(ciphertext)).rejects.toThrow()
  })

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
