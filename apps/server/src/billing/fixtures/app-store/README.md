# App Store test signing chain

A self-signed chain that mimics Apple's: the intermediate carries OID 1.2.840.113635.100.6.2.1 and the
signing certificate carries OID 1.2.840.113635.100.6.11.1. Tests trust `test-root.pem` in place of
Apple Root CA - G3 and sign transactions and notifications with `test-signing-key.pem`. Nothing outside
the tests trusts this chain. Valid until 2126.
