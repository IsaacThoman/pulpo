# Dependency security regressions

Run `npm run test:dependency-security`. These tests also run at the start of
`npm test` and exercise the installed dependencies through their consumers.

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
