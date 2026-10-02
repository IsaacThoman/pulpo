const assert = require('node:assert/strict')
const { constants, generateKeyPairSync, privateEncrypt, sign, verify } = require('node:crypto')
const { createRequire } = require('node:module')
const { test } = require('node:test')

const keys = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 3 })
const publicKeyPEM = keys.publicKey.export({ type: 'spki', format: 'pem' })
const privateKeyPEM = keys.privateKey.export({ type: 'pkcs8', format: 'pem' })
const message = Buffer.from('Pulpo dependency security regression')

// Resolve through both consumers so a future nested, vulnerable copy is tested too.
for (const consumer of ['@expo/cli', '@expo/code-signing-certificates']) {
  const forge = createRequire(require.resolve(consumer))('node-forge')
  const publicKey = forge.pki.publicKeyFromPem(publicKeyPEM)
  const digest = forge.md.sha256.create().update(message.toString()).digest().getBytes()
  const { asn1 } = forge
  const element = (type, value, constructed = false) =>
    asn1.create(asn1.Class.UNIVERSAL, type, constructed, value)

  function signature({ parameters = true, extraAlgorithm = [], extraDigestInfo = [] } = {}) {
    const algorithm = [element(asn1.Type.OID, asn1.oidToDer(forge.pki.oids.sha256).getBytes())]
    if (parameters) algorithm.push(element(asn1.Type.NULL, ''))
    algorithm.push(...extraAlgorithm)
    const info = element(asn1.Type.SEQUENCE, [
      element(asn1.Type.SEQUENCE, algorithm, true),
      element(asn1.Type.OCTETSTRING, digest),
      ...extraDigestInfo,
    ], true)
    // Sign a deliberately constructed DigestInfo to isolate the ASN.1 parser:
    // valid RSA padding/signature must not make malformed nested data acceptable.
    return privateEncrypt({ key: keys.privateKey, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(asn1.toDer(info).getBytes(), 'binary')).toString('binary')
  }

  test(`${consumer}: accepts SHA-256 signatures with NULL or absent parameters`, () => {
    for (const parameters of [true, false]) {
      assert.equal(publicKey.verify(digest, signature({ parameters })), true)
    }
    assert.equal(publicKey.verify(digest, sign('sha256', message, keys.privateKey).toString('binary')), true)
    assert.equal(publicKey.verify(forge.md.sha256.create().update('different message').digest().getBytes(), signature()), false)
  })

  for (const parameters of [true, false]) {
    test(`${consumer}: rejects extra nested DigestAlgorithm elements (NULL=${parameters})`, () => {
      assert.throws(() => publicKey.verify(digest, signature({
        parameters,
        extraAlgorithm: [element(asn1.Type.OCTETSTRING, 'unconsumed garbage')],
      })), /valid RSASSA-PKCS1-v1_5 DigestInfo/)
    })
  }

  test(`${consumer}: rejects duplicate NULL parameters and extra outer elements`, () => {
    for (const options of [
      { extraAlgorithm: [element(asn1.Type.NULL, '')] },
      { extraDigestInfo: [element(asn1.Type.OCTETSTRING, 'unconsumed garbage')] },
    ]) {
      assert.throws(() => publicKey.verify(digest, signature(options)), /valid RSASSA-PKCS1-v1_5 DigestInfo/)
    }
  })
}

test('Expo code signing still generates, validates, and uses a certificate', () => {
  const certificates = require('@expo/code-signing-certificates')
  const keyPair = certificates.convertKeyPairPEMToKeyPair({ publicKeyPEM, privateKeyPEM })
  const now = Date.now()
  const certificate = certificates.generateSelfSignedCodeSigningCertificate({
    keyPair,
    validityNotBefore: new Date(now - 60_000),
    validityNotAfter: new Date(now + 3_600_000),
    commonName: 'Pulpo dependency regression',
  })
  certificates.validateSelfSignedCertificate(certificate, keyPair)
  const signature = certificates.signBufferRSASHA256AndVerify(keyPair.privateKey, certificate, message)
  assert.equal(verify('sha256', message, keys.publicKey, Buffer.from(signature, 'base64')), true)
})
