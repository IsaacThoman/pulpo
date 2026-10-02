# Dependency security regressions

Run `npm run test:dependency-security`. These tests also run at the start of
`npm test` and exercise the installed dependencies through their consumers.

## Temporary node-forge pin

As of October 2, 2026, node-forge 1.4.0 is the latest published release and is
affected by [CVE-2026-85393 / GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
It accepts unconsumed elements in the nested DigestAlgorithm sequence during
RSA PKCS#1 v1.5 signature verification. npm reports this high-severity issue
through node-forge, @expo/cli, @expo/code-signing-certificates, expo, and
react-native-passkeys.

The root override temporarily selects the source archive for
[`ceba34402e329f0365134f23fe19898756527d65`](https://github.com/digitalbazaar/forge/commit/ceba34402e329f0365134f23fe19898756527d65)
from [upstream PR #1152](https://github.com/digitalbazaar/forge/pull/1152).
**This is an unmerged proposed fix, not a published or maintainer-approved
release.** Compared with v1.4.0, its only runtime change checks the nested
sequence's element count; the other changes are a regression test, changelog,
and prerelease version. The full commit and lockfile SHA-512 integrity pin the
archive. Installation needs neither Git nor a patch lifecycle script, including
when CI uses `npm ci --ignore-scripts`.

The regression tests resolve node-forge separately from both Expo consumers.
They reject extra nested elements with and without NULL parameters, duplicate
NULL parameters, and extra outer elements. They also accept legitimate SHA-256
signatures with and without NULL parameters, reject a mismatched digest, and
exercise Expo certificate generation, validation, and signing with independent
verification using Node's crypto API. The malformed nested cases fail against
the previously installed 1.4.0 release.

Audit results are advisory/version metadata, not proof that an unreleased
revision is secure. Keep these behavior tests even when npm audit reports no
high or critical findings. Replace the archive override with a published fixed
release when one is available, rerun the tests and both full and production
audits, and remove the override if Expo's dependency ranges resolve that release
without it. Moderate findings are outside this change's scope.
