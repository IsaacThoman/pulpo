# pulpo

A ChatGPT/Open WebUI-style chat interface **UI mockup** — no backend, all data is mocked locally.

## Stack

- **React 19 + Vite** (TypeScript)
- **Tailwind CSS v4** + **shadcn/ui** primitives
- **zustand** for state (chat, settings, usage, API keys)
- **lucide-react** icons
- **recharts** for usage charts, **react-markdown** for message rendering

## Run

```bash
npm install
npm run dev
```

## Features

- **Chat** — streaming simulation (token-by-token), reasoning blocks for reasoning models,
  markdown + code blocks, message actions (copy / regenerate / edit / rate / read-aloud),
  per-message token + cost + latency metadata, stop generation
- **Sidebar** — collapsible, pinned chats, folders, time-grouped history, per-chat menus
  (pin / rename / move / share / archive / delete), pinned-model shortcuts, archived chats
- **Model selector** — searchable, theme-aware square avatars (light/dark), context + capability tags
- **Usage dashboard** (inspired by OpenWebUI-Monitor) — balance, stat cards (calls / tokens /
  spend / avg / water use), time-range + metric toggles, daily bar chart, 365-day heatmap,
  recent usage, top models
- **Leaderboard** — sortable by spend/tokens/calls/balance, custom nicknames + bar colors,
  most-expensive-call highlight, global activity feed
- **Admin** — user table (edit balances, block, copy viewer links), model pricing table with
  inline editing + availability testing + JSON import/export, analytics with pie chart,
  highlights, paginated records, CSV export
- **API keys** — create/revoke OpenAI-compatible keys with scopes, model restrictions, monthly
  budgets; one-time secret reveal; curl + OpenAI SDK snippets
- **Settings** — general (theme), account, personalization (custom instructions, memories),
  interface, audio, API keys, data controls, about
- **Admin panel** (`/admin`, options lifted from chat-deathgrips / Open WebUI):
  - Dashboard — 24h stats, quick links, system info
  - Users — role selects, add/edit modals; Groups tab with default-permission matrix
  - Models — search + view filters, per-model menus, enable toggles; full **model editor** with
    system prompt, advanced params, capability toggles, JSON preview, and the fork's signature
    **light/dark profile-image upload grid**
  - Functions — pipe/filter/action/event cards w/ valves, global toggles
  - Evaluations — arena model sets, Elo leaderboard, feedback table w/ export
  - Settings — General (feature toggles, banners editor, webhooks), Authentication (roles,
    signup, API keys, JWT, LDAP, OAuth), Connections (OpenAI/Ollama endpoints w/ verify, plus
    the fork's **usage portal** config), Interface (task model, title/follow-up/tag generation),
    Web Search (15+ engines w/ per-engine fields), Documents (extraction engines, embedding,
    hybrid search, RAG template, danger zone), Images (4 engines), Audio (6 STT + 6 TTS
    engines), Code Execution (pyodide/jupyter), Integrations (tool/terminal/knowledge servers),
    Database (import/export)
- Light/dark/system theme, ⌘K search, ⌘B sidebar toggle, ⌘, settings

## Mock notes

- All data is generated with a seeded PRNG (`src/lib/mock.ts`) so it's stable between reloads.
- Streaming is a local timer-based simulation in `src/stores/chat.ts` — swap `startStreaming`
  for an SSE reader to go live.
- Settings and API keys persist to `localStorage`.
