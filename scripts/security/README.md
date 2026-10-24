# Dependency security regressions

Run `npm run test:dependency-security`. These tests also run at the start of
`npm test` and exercise the installed dependencies through their consumers.

## Zod collection validation and Expo compatibility

Direct consumers now require Zod 4.6.7 or later to address
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
Oversized arrays, maps, and sets with upper size bounds are rejected before
validating their elements. Unconstrained collections still need application
limits; upgrading does not impose a universal collection-size limit.

Expo CLI 57.0.17 still requests Zod `^3.25.76`, which has no patched release.
The scoped `@expo/cli` override selects Zod `^4.6.7`. The CLI's runtime Zod
consumers use APIs supported by both major versions: devtools plugin metadata,
plugin output validation, and MCP command schema construction. Regression tests
load those actual CLI modules and cover valid and invalid metadata, text/audio/
image output, typed command parameters, command enums, strict objects, and JSON
Schema conversion. They also verify early rejection through each direct
consumer's installed Zod, synchronously and asynchronously. Recheck these paths
when Expo CLI changes, and remove the scoped override when Expo requests a
patched Zod version itself. The collection regression parses elements beyond
the upper bound against the previous Zod 4.4.3 release.

## Undici response handling

The server requires Undici `^8.12.2`; the lockfile selects 8.12.3 and updates
the existing 7.x and 6.x consumers to 7.30.1 and 6.29.1. Each remains on its
existing major version. These patches address
[GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c),
[GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685), and
[GHSA-f72v-6w45-q472](https://github.com/advisories/GHSA-f72v-6w45-q472).

Regression tests resolve Undici through the server, Electron downloader,
semantic-release GitHub plugin, and node-gyp. Each runs in a child process and
checks an ordinary response, then a malicious response with six content
encodings and an early connection close. The fetch rejection must be handled
without an unhandled stream error terminating the process. This follows
[upstream's regression](https://github.com/nodejs/undici/commit/07ded49).
The previous 8.10.2, 7.30.0, and 6.29.0 releases fail this crash regression.

## Electron certificate mitigation

The desktop application pins Electron 43.8.3, which includes the certificate
distrust mitigation for
[GHSA-jr5w-w6x2-84p9](https://github.com/advisories/GHSA-jr5w-w6x2-84p9).
The CI audit continues to check development dependencies because Electron is
declared as a build dependency but ships as the desktop application's runtime.

## Release-note Handlebars compiler

The lockfile updates Handlebars from 4.7.9 to 4.7.10 within
`conventional-changelog-writer`'s existing dependency range. This fixes the
critical [AST type confusion](https://github.com/advisories/GHSA-8r5x-fm3f-whwj)
and [own property check bypass](https://github.com/advisories/GHSA-p8wg-vrv2-v86f)
advisories, as well as the
[inline precompiled template embedding](https://github.com/advisories/GHSA-xw65-4hp5-5hc7)
advisory. No new override is required.

Regression tests resolve Handlebars through the changelog writer, reject a
malformed `Program.blockParams` in both compilation APIs, and verify that a
prototype's own `constructor` remains inaccessible even when prototype methods
are allowed. An integration test generates release notes through
`@semantic-release/release-notes-generator` and checks the summary and GitHub
commit/comparison links.

## Temporary braces fork

As of October 3, 2026, braces 3.0.3 is the latest published release and all
published versions are affected by
[CVE-2026-93687 / GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
Recursive AST walkers can exhaust the call stack on deeply nested input under
the existing 10,000-character limit. This propagates through micromatch into
Metro, Expo, React Native, and semantic-release.

The root override selects the local `@pulpo/braces` fork in `vendor/braces`.
Its runtime files and MIT license are copied verbatim from
[`28d440b5dd449dbf1fe6f3506cf94ecca4d02660`](https://github.com/FSDevelop/braces/commit/28d440b5dd449dbf1fe6f3506cf94ecca4d02660),
the head of [upstream PR #72](https://github.com/micromatch/braces/pull/72).
**This is an unmerged proposed fix, not a published or maintainer-approved
release.** The fork caps brace and parenthesis nesting and caller-supplied AST
depth at 100 and rejects cyclic AST parent chains. Stricter `maxDepth` options
are honored; larger values cannot disable the cap. The source also includes
upstream's unreleased fixes for unpaired quotes and range/set expansion.
Only the package manifest is customized: a private name/version, the existing
fill-range dependency and Node requirement, and no lifecycle scripts.

The separate package identity distinguishes this reviewed source from the
vulnerable npm release, which still has version 3.0.3 even in the proposed fix.
An archive override alone continued to flag its version and downstream
consumers in npm audit. Vendoring makes the actual patched source reviewable
in this repository and works with `npm ci --ignore-scripts`; it does not rely
on suppressing advisories or patching node_modules after installation.

Regression tests resolve braces through each Metro and semantic-release
micromatch consumer. They cover 4,000-level malicious patterns, caller-supplied
ASTs, the 100/101 depth boundary, fractional and oversized limits, cyclic
parents, and ordinary expansion, escaping, and glob matching. Replace the
local fork and override with a published fixed braces release once available,
then rerun these tests and both full and production audits.

## Fastify multipart parser

The lockfile updates `@fastify/busboy` from 3.2.0 to 3.2.2 within
`@fastify/multipart`'s existing dependency range. This fixes
[CVE-2026-19484](https://github.com/advisories/GHSA-xjh9-v7x6-24jw) and
[CVE-2026-19481](https://github.com/advisories/GHSA-x8mw-p69m-v3mx).
Regression tests resolve the parser through Fastify multipart and exercise
ordinary and prototype-named headers with ordinary, 252-byte, and oversized
boundaries, plus a fragmented 252-byte boundary mismatch. Each parser runs in
a child process with a timeout so a synchronous
boundary-search infinite loop fails safely.

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
