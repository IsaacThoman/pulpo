# Private profiles

An account can switch private profiles from the web account menu or the mobile drawer. The web Profiles settings panel and mobile Settings provide creation, renaming, color customization, and deletion. Chats, folders, attachments, composer and shelved drafts, memory documents and revisions, embeddings, imports, and preferences belong to a profile. Authentication, billing, account quotas, provider connections, API keys, friends, and public identity belong to the account.

## Migration and compatibility

Migration `0066_profiles.sql` creates a Personal profile for every existing user. Its ID equals the existing user ID, which also identifies legacy local data. Resource IDs, settings documents, attachment object keys, and memory content remain unchanged. An account-registration trigger creates Personal for new users. Newly created profiles receive the instance's new-account model defaults and otherwise start empty.

Deploy the migration before starting the updated API and workers. The migration backfills existing tables and replaces account-only uniqueness constraints; allow for table locks on large installations. Back up the database and object storage first. Do not run old application workers concurrently with the new profile-aware application: legacy HTTP clients are supported, but old server processes do not enforce profile isolation.

Full backups preserve profile rows and profile ownership. Restoring an older archive creates Personal and assigns legacy rows to it. The restore transaction suppresses the registration trigger while loading explicit profile rows.

## Request and worker scope

Authenticated private requests accept `X-Pulpo-Profile-Id`. Socket.IO clients send `auth.profileId`. An omitted selection resolves to the account's default profile; an invalid, foreign, or retiring selection is rejected. Authenticated media URLs may carry the validated `profileId` query parameter. Public share tokens retain their explicit share authorization.

The CLI accepts `--profile <uuid>`. API keys remain account-wide and can use the same profile header. `/api/profiles` returns the profile list and `defaultProfileId`; POST creates a profile, PATCH `/api/profiles/:id` changes its name/color, and DELETE requires `{ "name": "exact profile name" }`.

Handlers run in an immutable asynchronous `{ userId, profileId }` context. Profile-aware predicates accompany ownership and resource-ID checks. Database triggers validate profile ownership and parent references and reject transfers. Background generation and indexing derive the context from the originating resource, so switching does not retarget running work. New private resource queries must use profile-aware predicates; account-wide maintenance must deliberately run without a profile context.

Private realtime subscriptions use profile rooms. Composer rooms include both account and profile. Account-level events, including profile-list changes, retain account rooms. Recovered sockets drop old resource subscriptions and revalidate their selected profile.

## Local state and deletion

Browser selection uses session storage; desktop selection uses local storage. Native selection persists in SQLite. Profile caches retain legacy Personal namespaces and isolate additional profiles by instance/account/profile. Switching checkpoints local drafts and uploads, pauses synchronization, replaces visible state, hydrates the destination cache, and invalidates callbacks from the previous scope. Cached profiles can be selected offline; creation and management require the server.

Deletion serializes on the account row, prevents removal of the final profile, and assigns the oldest remaining profile as default when necessary. It immediately hides the profile, revokes shares, removes queued messages, requests cancellation, and disconnects selected sockets. Cleanup is durable and retryable through the maintenance queue and periodic recovery. It waits for active responses and outstanding upload URLs (16 minutes), then removes workspaces, blobs, memories, and content. Account billing and provider credentials survive. Clients fall back to the remaining default and remove the retired profile's cache.

## Validation

Run the repository tests with bounded Vitest concurrency. Node 26 requires `NODE_OPTIONS=--no-experimental-webstorage` for the existing browser-storage test environment.

The opt-in PostgreSQL tests refuse non-test database names:

- `PULPO_PROFILES_TESTS=1`: `src/profiles/isolation.integration.test.ts`, using a migrated `pulpo_profiles_isolation_test` database. Covers resource isolation, concurrent scopes, parent inheritance, cross-profile references, shared storage quota, deletion races, active work, cleanup retries, and credential preservation.
- `PULPO_PROFILES_MIGRATION_TEST=1`: `src/profiles/migration.postgres.test.ts`, using `pulpo_profiles_migration_test`. Rebuilds the prior schema, migrates populated data, and restores a populated legacy archive.
- `PULPO_PROFILES_REALTIME_TEST=1`: `src/profiles/realtime.integration.test.ts`, using `pulpo_profiles_test` and a disposable API at port 30527. Exercises multiple profiles and accounts over real Socket.IO connections, including foreign handshakes and deletion disconnects.

These fixtures delete their disposable data. Raw screenshots, bundles, simulator files, and test credentials are not repository artifacts.
