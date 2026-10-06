# App Store signing test fixtures

A self-signed test chain for `app-store-signing.test.ts` and `app-store.test.ts`. The
intermediate and leaf carry Apple's App Store marker extensions
(`1.2.840.113635.100.6.2.1` and `1.2.840.113635.100.6.11.1`); `test-unmarked-leaf.pem`
omits the leaf marker. The keys sign test payloads only. Production verification trusts
only Apple Root CA - G3, so this chain is never accepted outside tests.

The certificates are P-256 and valid from 2020 to 2120. They were generated with OpenSSL
using `-not_before 20200101000000Z -not_after 21200101000000Z`, a `basicConstraints`
CA flag on the root and intermediate, and `<oid> = ASN1:NULL` for each marker.
