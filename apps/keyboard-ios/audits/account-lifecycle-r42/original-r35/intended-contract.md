# R35 intended account lifecycle contract (pre-exploration)

Captured from the user brief before further implementation inspection. This is an intended behavior contract, not a claim that every operation already has an executable test seam. The later public runner protocol must disclose unavailable operations.

An explicitly submitted sign-in may publish credentials to the app Keychain, the app session, and the extension-visible account snapshot only while its owning presentation/attempt remains authorized. Cancel, interactive dismissal/back, superseding submission, and explicit sign-out revoke that authority synchronously. Cancelling the Swift task must also revoke authority. An already-issued HTTP request cannot be unsent; its late outcome must not mutate local account state. No automatic logout request for an abandoned newly-created remote session is proposed in this sweep.

A new attempt is usable after cancellation or failure. The current attempt's ordinary errors and two-factor challenge remain usable. Cancelling a two-factor flow discards its local challenge. Back from two-factor returns to a consistent credential entry state. Server changes affect the next submission; an issued submission uses its captured server. Successful authorized login preserves normal persisted session and dictation account status.

Account refresh may update only the session identity and authorization generation that launched it. Refresh started before sign-out, a new login, or session replacement cannot resurrect an account, replace a newer login, or sign it out on a late unauthorized error. Current-account unauthorized refresh retains the app's established sign-out behavior. Concurrent refresh ordering must be explicitly specified before benchmark sealing.

Account changes must not change keyboard typing/search/private-field behavior or transfer a pending dictation request to a different owner. No extension networking or credential storage is introduced. Full audio, physical devices, and VoiceOver are outside this proof.

## Development scenarios (known, never counted as fresh blind cases)

1. Hold login success, Cancel/dismiss, release success; persisted and published account remain unchanged; retry succeeds.
2. Hold login A, submit B, finish B then A (success and error variants); B remains authoritative.
3. Hold configuration/login, cancel Swift task or sign out, release; no local publication.
4. Two-factor challenge, back/cancel, fresh attempt; stale challenge/errors cannot alter the new presentation.
5. Refresh A held, explicit sign-out, late success; signed-out persistence survives reconstruction.
6. Refresh A held, login B, late success or 401 from A; B survives in memory, Keychain, and snapshot.
7. Authorized ordinary success/error/2FA and current refresh success/401; preserve expected usability.
8. Server edit during pending operation; submission uses original server and next submission uses edited server.

Native checks, if a valid candidate exists: actual Cancel and dismissal/retry, two-factor focus/back, Settings navigation; ordinary and largest accessibility size where meaningful. Only assigned iPhone 17 1EDC5D9A-7E25-432A-B5B1-9A8B702306A7, restore large/hardware keyboard false, no reset/erase.
