# Shelved drafts

The regular new-chat composer has an account-wide shelf on web, iOS, and Android. **Shelve draft** saves exact text and ordered attachments, then clears the composer. The tray opens to reveal the saved draft. Restoring into a nonempty composer saves the outgoing draft in the selected row's position. Model, presets, Agent mode, and other composer settings stay unchanged.

The tray uses the queued-message controls, including drag ordering on web and iOS and accessible move actions on every platform. Mobile collapses it when the keyboard focuses the composer. Delete removes the draft immediately without confirmation. Temporary mode and existing conversations hide the shelf. Empty or whitespace-only text without attachments is treated as an empty composer; whitespace around nonempty text is preserved.

## Persistence and synchronization

`GET /api/shelved-drafts` returns an account revision and ordered drafts. Authenticated `POST /api/shelved-drafts` accepts a stable client-generated `operationId` and a `save`, `restore`, `delete`, or relative `reorder` action. Restore optionally includes a replacement draft. Clients supply ordered attachment IDs; the server validates ownership and readiness and loads canonical metadata.

PostgreSQL transactions serialize shelf mutations per account with an advisory lock. Drafts, attachment references, operation receipts, and account revisions commit together. Consumed/deleted draft IDs remain tombstones so delayed creates cannot resurrect them. Duplicate operation IDs return the current snapshot. Relative moves with missing items or targets leave the order unchanged.

Accepted mutations publish the `shelved-drafts` invalidation scope through the existing account revision, Redis, and socket flow. Clients refresh on reconnect and foreground; web also listens for online events. Shelf synchronization runs independently of **Sync composer drafts**. Changes to the active composer continue to honor that preference. Shelf operations never submit messages or create chats.

## Offline recovery and attachment ownership

The local shelf snapshot and operation journal commit in the same transaction as the new composer draft before UI clearing or replacement. Web stores attachment blobs in account/instance-scoped IndexedDB and coordinates tabs with Web Locks. Mobile copies local sources into account-scoped document storage before committing its SQLite checkpoint. A failed local save leaves the composer intact.

Pending operations overlay the latest server snapshot and replay in order. Files upload under shelf ownership even after the composer navigates away. Items appear on other devices only after their files are ready and the server accepts the save. Connectivity failures remain pending; failed operations keep their content and files available for Retry, Restore, or Delete. Restoring or deleting a failed pending save can consume it without completing an obsolete upload.

Ready file sources remain cached for offline restoration. A remote file without a local preview retains its attachment reference. Restores preserve attachment order without applying the mobile picker's lower selection limit; existing send-time validation still applies.

Shelved attachments have an account-owned lifetime (`attachments.shelved_at`) and are detached from a single chat. Sending a restored file does not bind its lifetime to that chat's purge. Attachment deletion checks message, queued-message, composer, and shelf references. Local cleanup checks other drafts before releasing sources. Account removal clears its local shelf data and durable native sources.

Composer handoffs check the captured scope, content, and attachment selection before applying changes. With composer sync enabled, a checkpoint protects restored content during reconciliation; divergent content displaced by a remote draft is saved as a recoverable shelf copy. Concurrent offline restores can therefore create multiple working copies while the server consumes the shelf item only once.

## Rollout and verification

1. Apply additive migration **0062_shelved_drafts** with `npm run db:migrate` before starting the updated server.
2. Deploy the updated server before updated web/mobile clients. Older servers leave shelf operations pending locally; they cannot synchronize them.
3. Verify two devices on one account, including composer sync opt-out, offline restore/swap, attachment upload, reconnect, ordering, and deletion. Check iOS/Android keyboard transitions, large text, themes, and accessibility on devices before release.

Automated coverage includes shared journal/recovery behavior, real IndexedDB transfers, native file copying and attachment-order preservation, and opt-in PostgreSQL transactions. Run PostgreSQL shelf tests only against the disposable `pulpo_shelf_test` database with `PULPO_SHELF_TESTS=true`; they create isolated test users and do not truncate data.

Development validation included the affected contracts, client-core, server, web, and mobile suites; server/web builds and mobile type checks; iOS and Android bundle exports; Swift syntax parsing; and browser checks against a disposable server/database. Browser checks covered narrow and desktop layouts, both themes, attachment reload/restore, temporary-mode exclusion, swaps, and second-tab realtime ordering. Native device visual QA and production deployment are separate release steps.
