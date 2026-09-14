# Web responsive layout audit

Audit date: 2026-09-14. Target: web layouts, including the space left beside the expanded 264px sidebar.

## Fixes

- Personal and public recent usage now use a single intrinsically sized table with sticky headers inside a keyboard-focusable scroll region. Dates, token counts, costs, and balances retain their own columns; horizontal scrolling moves headings and rows together.
- Usage, billing, request, workspace, and memory statistics reflow according to their container width. Large values can wrap without painting over adjacent values.
- Usage and admin navigation remain scrollable; admin settings switch to horizontal navigation before the content becomes cramped.
- Admin form controls stack in narrow sections. User search, model actions, memory controls, and backup actions wrap as needed. Long model names and IDs remain contained.
- Billing and API keys use the existing page-header pattern, reserving room for the mobile sidebar button. Plan comparison stays stacked at tablet widths.
- Shared dialogs fit short viewports; search results retain their own scroll area. Popovers, selects, and dropdowns stay within phone widths. The managed-model dialog remains scrollable.

## Browser coverage

Used an isolated local API, PostgreSQL, Redis, and Vite frontend. Dummy data included seven accounts, six friendships, 1,085 usage records, large balances and payment totals, long names/model IDs/API-key names, and a completed chat with a long URL, code, and a table. Billing used dummy configuration; no checkout or model inference was performed.

| Area | Coverage |
| --- | --- |
| Main routes | Chat landing, personal/friends/pool usage, friends, API keys, billing |
| Admin routes | Users, chats, image/speech models, providers, labs, icons, models, leaderboard, requests, workspaces, billing, settings |
| Settings | Every available user and admin settings section at 320, 640, and 750px |
| Dialogs | New model, managed-model context, provider, lab, API key, plan comparison, credit purchase; short-screen search |
| Public routes | Login/options, signup, password recovery/reset, account deletion, pending, privacy, support, passkey, invalid shared link |
| Chat content | Completed private/shared chat at 320, 390, 750, and 1280px |

Main route checks used 320, 390, 640, 750, 900, and 1280px widths. Public-route checks used 320, 390, 640, 750, and 1280px. The 750px case explicitly exercises the expanded sidebar breakpoint. Intentional table/calendar scrolling and the settings save bar's 4px decorative bleed were excluded from page-overflow findings.

This audit used Chromium. Real Safari/Firefox, the iOS keyboard, live inference, Stripe checkout, and an active workspace controller were not exercised.

## Repeatable regression check

From the repository root:

```sh
npm ci
npm run build -w @pulpo/contracts
npm run build -w @pulpo/client-core
npx playwright install chromium
npm run test:responsive -w @pulpo/web
```

The browser check starts and closes its own Vite server and requires no database or credentials. It covers 48 combinations of viewport width, English/Spanish, and optional user/balance columns. Spanish cases also use dark mode. Assertions cover cell/header geometry, container overflow, large statistics, fixed-width form controls, sticky headers after scrolling both axes, pagination, a 320×360 dialog, and a wide popover. The original usage implementation fails the regression check.

Additional validation: web production build, all 707 web unit/component tests, and repository lint. On Node 26, run the unit suite with `NODE_OPTIONS=--no-experimental-webstorage` to avoid Node's experimental global storage interfering with the existing jsdom/Zustand tests.

Screenshots, browser logs, local credentials, and database dumps are not repository artifacts.
