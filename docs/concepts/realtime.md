# Local-first and realtime behavior

Pulpo keeps the interface responsive without treating browser storage as the system of record.

- Recent detailed chats are retained locally; users control the retention count in **Settings → Interface**.
- Cached conversations open immediately and revalidate in the background when the network is usable.
- Offline-safe chat and folder mutations enter an IndexedDB outbox with idempotency keys.
- Each browser tab maintains its own event cursor and deduplicates responses by ID and sequence.
- Socket.IO recovery handles short interruptions, Redis replays recent gaps, and PostgreSQL snapshots repair expired or large gaps.
- Worker ownership is independent of browser sockets, so closing every tab does not cancel generation.
- Background Responses resume from their upstream sequence after worker restart and fall back to retrieval polling.

PostgreSQL remains authoritative throughout this process. Local state accelerates the experience and safely represents pending work; it does not replace server reconciliation.
