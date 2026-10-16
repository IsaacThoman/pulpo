# Exposed new-round countercheck: old-upload unauthorized callback during replacement login

Status: source-derived, NOT EXECUTED. This is a new integration counterexample discovered after R35 reveal, not a change to its 24 frozen cases or an additional blind gain. Do not repair frozen R35 production/oracles in place.

Actual production route at candidate b2b31684:
1. Cached account A starts dictation. stop() captures A's URL/token, starts upload, and lifecycle remains transcribing (DictationService.swift:191–205).
2. A replacement sign-in B begins and waits for its config/login result. beginSignIn changes accountGeneration and signInAttempt but does not cancel dictation (AppModel.swift:192–196).
3. A's upload returns unauthorized before B commits. Task cancellation and dictation-lifecycle guards still pass. The upload invokes onUnauthorized (DictationService.swift:215–217).
4. The installed callback unconditionally invokes model.signOut(remote:false) without the upload's captured session/generation (AppModel.swift:69).
5. Candidate signOut clears signInAttempt (AppModel.swift:270–274), revoking B. It also cancels A's upload, which happens after that callback has already been authorized and entered.
6. Release B's valid login response. checkAuthority rejects it at AppModel.swift:224/214. SignInAttempt ignores the resulting CancellationError and ends working without showing an error. No new account is stored/published.
7. On baseline, signOut did not revoke pending sign-in. The same B response could commit. This is an introduced loss caused by routing an old asynchronous unauthorized event through the new explicit-sign-out authority revocation. Cancellation only at successful B commit (candidate line231) cannot fix the ordering above.

Proposed first executable check uses the EXISTING AppTests controlled URLProtocol/AppModel initializer and calls the ACTUAL installed dictation.onUnauthorized callback while B's real URLSession/PulpoClient login is held. This tests the concrete account authority regression at the callback boundary. It deliberately does not pretend an actual DictationService upload was performed. The supplied .swift.txt extension must be appended to the existing AccountLifecycleR35Tests.swift file (same-file private helper access), and run in separately authorized isolated baseline/candidate builds. Use baseline 4b6af6da's observational injection or the documented baseline instrumentation; original e6871a16 alone lacks the test initializer seam. No native/device run is authorized by this document.

Expected behavior: A's eligible401 may clear A, but must not revoke an independently submitted B; releasing B's valid response must succeed and match B in memory, app-only Keychain and AccountSnapshot. Explicit USER sign-out must still revoke B; keep that separate existing regression. A future actual-upload integration check should additionally verify the same event order through DictationService's real transcribing task and current lifecycle guard, without relying on a fabricated phase or weakening cancellation checks.

No candidate fix is selected here. Possible future designs must distinguish user revocation from session-owned unauthorized events, and/or end old dictation ownership at a clearly specified new-login boundary. Preserve current-account unauthorized behavior and deliberate failed-login cached-account semantics. Freeze that policy and new coverage before new independent evaluation; never retune R35 after reveal.
