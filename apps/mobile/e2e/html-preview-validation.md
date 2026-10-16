# iOS HTML attachment preview validation — October 16, 2026

HTML attachments used to open in Quick Look, which renders HTML without running its scripts. They now open in a sandboxed `WKWebView`. Other files still use Quick Look.

## Sandbox

- The page is served by a `WKURLSchemeHandler` from `pulpo-preview://<random-uuid>/`. The response carries `SANDBOX_CSP` from `@pulpo/contracts`, the same policy as the web and desktop preview sandbox. WebKit honours the CSP `sandbox` directive only as a response header, and that directive gives the page an opaque origin.
- The web view uses an ephemeral data store and registers no script message handlers. Native code rejects any policy that lacks `sandbox` or adds `allow-same-origin` or `allow-top-navigation`.
- The page may reload itself and follow its own `#fragments`. Tapped `http(s)` links, `target="_blank"` links, and user-initiated `window.open` calls open in `SFSafariViewController`. Scripted navigation, other schemes (such as `pulpo://`), relative resources, and form submissions stay blocked.
- `alert`, `confirm`, and `prompt` use native alerts. After two dialogs, a **Block Dialogs** action stops a page that loops on them. Camera, microphone, and motion permission requests are denied. If the content process crashes, the page restarts once and then shows a reload screen.
- Without its own viewport tag, a page is laid out at the device width, like the web preview's iframe. Pages over 10 MB, and binaries built before this change, fall back to Quick Look.

## Automated validation

- Mobile: `npx tsc --noEmit` passed. `npx vitest run src/native` passed 31 tests, including routing, fallback, and CSP forwarding.
- Packages: client-core passed 562 tests and contracts passed 238. Desktop `src/security.test.ts` (9) checks that the contracts copy of the CSP matches desktop, nginx, and both `sandbox.html` files. Desktop typecheck passed.
- Web: 1,305 tests passed with `NODE_OPTIONS=--no-experimental-webstorage` (needed under local Node 26; see [validation.md](validation.md)). `tsc -b` passed. Vite build passed, and the sandbox chunk stayed at 3.1 kB.
- `npm run lint` passed.

## Native run

Release builds were run on an iOS 27.0 iPhone 18 Pro simulator against a local Docker Compose stack. `node apps/mobile/e2e/html-preview-seed.mjs` imported chats carrying [octopus-flashcards.html](html-preview/octopus-flashcards.html) and [sandbox-probe.html](html-preview/sandbox-probe.html). The baseline was an unmodified build of `dev`.

**Before:** Quick Look showed only the flash cards' static "needs JavaScript" notice. The probe reported "Scripts did not run."

**After:**

- The flash card deck ran: cards flip, scoring works, a finished deck shows 6/8 with the missed questions, and **Practice again** re-quizzes only the missed cards.
- **View Source**, **Reload** (restarts the deck), **Share…** (shares the `.html` file), and **Done** all worked. Reopening right away, or after closing a Quick Look preview, worked without a busy error.
- The probe passed 9/9 automatic checks:
  - JavaScript runs.
  - `self.origin` is `null`.
  - `localStorage` throws `SecurityError`.
  - `document.cookie` is empty.
  - No `window.webkit.messageHandlers`.
  - `innerWidth` is 402.
  - Plain-HTTP fetches, extra paths on the preview host, and frames are blocked.
- Probe manual checks:
  - `alert` returned `undefined`, `confirm` returned `false` on Cancel, and `prompt` returned `"Pulpo"`.
  - The five-alert loop offered **Block Dialogs**, which stopped it.
  - Link, `target="_blank"`, and `window.open` opened example.com in Safari View Controller; `window.open` returned `null`.
  - Scripted navigation, the `pulpo://` link, and the form submission stayed on the page.
  - The fragment link scrolled in place.
- A `.txt` attachment still opened in Quick Look.
- In dark mode, the navigation bar follows the system appearance and the page keeps its own colours.

The probe's manual checks were first run on a build that was then rebuilt for three issues found during testing: the viewport timing, the bottom safe-area strip, and the dark-mode navigation bar. On the final build, the automatic probe checks, `alert`, the external link, and the flash card flip were rerun.

Not covered: Android (unchanged; it opens HTML through the system viewer), attaching HTML from the composer (uses the same `openAttachmentFile` path), and a physical device.

## Screenshots

| Before (Quick Look) | After |
| --- | --- |
| ![Flash cards in Quick Look](evidence/html-preview/before-flashcards-quicklook.png) | ![Flash cards running](evidence/html-preview/after-flashcards-question.png) |
| ![Probe in Quick Look](evidence/html-preview/before-probe-quicklook.png) | ![Probe checks passing](evidence/html-preview/after-probe-checks.png) |

![Flipped card](evidence/html-preview/after-flashcards-answer.png)
![Finished deck](evidence/html-preview/after-flashcards-results.png)
![Dark mode](evidence/html-preview/after-flashcards-dark.png)
![Probe manual checks](evidence/html-preview/after-probe-manual-checks.png)
![External link in Safari View Controller](evidence/html-preview/after-probe-external-link.png)
