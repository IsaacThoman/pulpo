# R35 independent parent source review — do not adopt frozen candidate

Reviewed worker tip dd882f4c9658ac38ed11c4c7c36c50c60fc2fef8, production b2b31684 against e6871a16. Worker stayed clean. All six observed production-source hashes remain identical to b2b31684; no app/services/development-test source difference was found between pre-reveal3db59146 and terminal dd882f4c. This review executed no app, build, native/device or account API. The new countercheck is uncompiled/unexecuted.

## Blocking introduced regression: old upload401 cancels an explicit replacement login

An account A upload remains current/transcribing while B's login is pending because beginSignIn only changes account authority (AppModel.swift192–196); dictation is canceled only after successful persistence (231). The upload's unauthorized catch still reaches the unqualified onUnauthorized callback (DictationService.swift215–217; AppModel.swift69). That callback calls signOut(false), which now clears signInAttempt (272). Releasing B's valid response consequently throws CancellationError at224/214. SignInAttempt suppresses that error at42 and finishes working at33, leaving the user signed out instead of completing B's explicit login.

The baseline also cleared A for its upload401, but its signOut did not revoke pending B, so B could still succeed. This is an introduced authority/UX regression, not a claim of a new credential leak. An unchanged callback is not sufficient protection when its callee gains broader revocation effects. The existing refresh guards already distinguish generation/start ordering; dictation's callback carries no equivalent session authority. The report calls this interleaving unproved, but its concrete source ordering is enough to withhold publication until a new-round countercheck/fix is separately authorized. Do not repair or retune the revealed R35 candidate.

countercheck-contract.md specifies the actual upload path and a bounded first integration check at the real installed callback boundary. countercheck.swift.txt appends to the existing controlled AppModel/URLSession test file, holds B's actual login response, invokes the installed callback, then expects B in memory/Keychain/snapshot. It deliberately claims no audio-upload execution. Baseline requires its existing observational injection. A future actual DictationService upload/permission integration still requires authorized native validation.

## Other source findings

Synchronous presentation authority before Task creation, cancellation/disappearance/Back revocation, stale failure suppression, and success publication without an intervening await are coherent under the app's MainActor default. Issued credentials/server are deliberately captured per the prewritten contract; later field edits reset a 2FA challenge rather than retargeting an issued request. No separate blocker found there.

Refresh eligibility checks generation, session URL/token, latest-started UUID, task cancellation, and the permanent beganDuringSignIn flag. They implement the specified latest-started-wins policy, including later failed/canceled refreshes. Eligible current unauthorized refresh still signs out. No new refresh source blocker found.

After actual replacement or explicit sign-out, dictation.cancel invalidates its lifecycle before a delayed microphone-permission callback can pass isCurrent(preparing). No source-confirmed permission-return transfer was found. This does not validate recording/upload/session ownership generally. cancel also enters standby rather than necessarily stopping the audio engine; no new microphone/privacy acceptance is inferred.

SessionStore's update-before-add avoids the prior destructive delete-before-save sequence. Login and refresh now check save's Bool before replacing memory/snapshot; failure keeps the previous cached account and returns the explicit login error. Actual OS Keychain/protected-data failures were not injected. clear still ignores SecItemDelete failure, a pre-existing persistence limitation; reconstruction/disk-flush guarantees remain unproved.

Largest-accessibility drag dismissal remains unresolved, so native cancellation evidence is incomplete at that size. The package result is five known issues plus four timing failures without a paired baseline attribution. Neither issue should be relabeled green, nor assumed to be a new source regression from the account diff.

Recommendation: valuable account/presentation improvements and reproducible evidence merit preservation, but frozen R35 is not acceptable for adoption because of the concrete old-upload/new-login counterexample. If continued, use a separately frozen implementation round with this exposed control and fresh independent schedules; do not reinterpret24/24 as full account/dictation lifecycle acceptance.
