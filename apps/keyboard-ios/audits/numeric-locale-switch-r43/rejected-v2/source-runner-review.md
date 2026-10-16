# R43 v2 independent source and runner review before fresh authoring

Decision: **no production-source blocker or newly introduced native action-path regression found. The paired-wrapper status and locale-format issues identified during review have been addressed before freeze. Final independent scoring and build-artifact provenance remain gates.** No v2 execution, benchmark acceptance, or installed extension pass is declared.

Reviewed the v2 contract, public protocol, oracle schema, final native executor and paired wrapper, v1 candidate/executor/proof reviews and their responses, production two-file diff, and relevant production layout, touch, controller, language-loading and input-policy code. Also inspected the native App/project scaffold, current generated smoke xctestrun structure and the local Xcode xctestrun manpage. No v2 benchmark inputs, outputs, developer cases, candidate test source, or successful logs were read. No reviewed artifact was edited. Only this report and its digest were written. Repository HEAD remains b5451e4211f0aa735233d5de8b98b5708c0e8a0d; git diff --check passed.

## Production source

The repair is unchanged from the previously reviewed candidate: Foundation autoupdating region punctuation is resolved independently of typing language; invalid injected separators fall back to period; the resolved separator participates in the controller layout cache at actual synchronization. Decimal plus required globe creates separator/globe/zero/delete with four .75-pitch widths. KeysView subtracts the existing gap from each pitch fraction, so four controls consume the same three-pitch row span. Number/ascii-number behavior, upper rows, height, phone dispatch, ordinary layouts, engine, privacy/learning, touch routing and AX implementation remain unchanged. The visible globe uses the existing nextKeyboard action and identifier.

No source-level defect or scope expansion was found. This source finding does not substitute for fresh independent scoring, live locale-transition execution, or installed extension evidence.

## V2 fixture and locale changes

The executor now uses a nonsecure native UITextField.textContentType=.oneTimeCode for privateField, sets clearsOnInsertion=false and restores its end caret after mounting. The unchanged UIKit trait adapter copies the content-type raw value, and unchanged InputTraits includes oneTimeCode in its private-content set. This exercises a real sensitive native-field privacy path without relying on secure-field first-insert behavior. The contract/protocol explicitly define this fixture before fresh authoring and exclude secure system-field behavior and installed OS fallback. The V2 fixture change does not repair production secure fields or retroactively pass rejected v1 secure workflows. The field remains a real UITextField whose insert/delete/selection/context methods back the TextDocument host. It is manually mounted and never made first responder; this is hosted UIKit/controller evidence, not a UITextDocumentProxy or installed extension test.

The wrapper now copies the generated xctestrun and sets CommandLineArguments to -AppleLocale <exact identifier> -AppleLanguages (<language>). The local Xcode manpage explicitly documents these arguments as arguments supplied to the test-host process. The inspected generated plist is FormatVersion 1 with a top-level R43Tests entry containing TestHostPath; locale_run patches this actual structure. The ar_EG copy contains the literal ar_EG/(ar) arguments. This verifies configuration provenance only, not the process's effective locale. The native current/autoupdating observations and independent oracle must still reject any identifier, region or separator mismatch.

locale_run is specific to that generated FormatVersion 1 structure and now requires exactly one patched target. An unsupported nested FormatVersion 2 structure or changed target count fails explicitly instead of silently claiming configuration. The project now supplies an explicit Info.plist with en/es/ar CFBundleLocalizations, permitting the requested host-language configuration. These source/configuration changes do not establish the eventual effective locale; runtime current/autoupdating locale gates remain mandatory.

The v2 public address-mode learning clarification matches unchanged InputPolicy: numeric, private, email and URL disable learning; standard plain prose can enable it. The prior v1 URL failure stays a rejected-v1 oracle mismatch and is not a production change or retroactive pass.

## Action and geometry evidence

Every supported workflow action follows the production controller/KeysView path or a disclosed explicit host refresh/trait change. The driver records each action including missing-key, unsupported-operation and rejected-AX errors, followed by exactly one explicit documentDidChange callback. Generic key excludes nextKeyboard; touch globe supplies a UIEvent, while AX directly calls accessibilityActivate. These routes remain separate: touch means two host list callbacks, AX means one advance callback. Neither route establishes an installed OS menu or spoken VoiceOver behavior. Before/after caret diagnostics are present; selection is not an advertised workflow operation.

The native runner is deliberately an observation producer. It does not itself compare expected text/callbacks, strictly validate every input value, require one action match, or assert geometry booleans. Mandatory independent validation/scoring must therefore remain the semantic gate. Schema-required exact action identity/order, all intermediate/final literal outcomes, no action errors, locale, loaded language, nonempty resource measurements, stack identities, policy/count/dirty continuity and all geometry booleans cannot be replaced by XCTest transport success. The oracle implementation is being reviewed independently and was not source-reviewed here.

Geometry remains the previously reviewed conservative method: cap x-bounds plus one point above/below, clipped to KeysView bounds; cap center/four inset corners and a two-point grid test native keyIndex and root hit routing, with direct began/ended touches at five points. A temporary recorder prevents probes from editing documents and restores the controller delegate with defer. Initial and final geometry are recorded. This is sampled target evidence at the stated resolution, not exact whole-hit-area measurement or proof of every unsampled real coordinate. Intermediate layout snapshots are absent. First matching action lookup and possible repeated prose punctuation identifiers remain previously disclosed restrictions; any schema/geometry failure must remain in the denominator.

Portrait numeric bottom targets must satisfy the frozen 44-point width/height gates. Landscape retains existing short vertical targets; it can pass only the explicitly bounded landscape contract, not blanket 44-by-44 usability. One-handed requests and effective grid width are separately reported. Width-triggered landscape is not a physical rotation experiment.

## Pre-freeze orchestration response

The initial reviewed wrapper always returned 0 after both semantic score calls, including candidate failure. This repeated the previously documented v1 status issue. The updated wrapper now retains both complete verdicts/receipt and returns 1 when the candidate scorer process exits nonzero, the candidate verdict does not pass, or a baseline passing row becomes candidate failing. Baseline expected contract failures remain visible and can coexist with command success only when the complete candidate passes. This is an appropriate distinction between paired acceptance and baseline scoring; baseline failures must still be reported in full.

The candidate process-status consistency recommendation was also implemented before admission: candidateExit must be zero as well as passed=true. The regression zip comparison relies on the mandatory oracle's exact matching IDs/order/row retention; final proof must verify those invariants. A nonzero baseline semantic status is expected for exposed baseline defects and remains visible in its full verdict, not a baseline pass.

No new production blocker or native action-path regression was found in the private-content fixture, locale localization/argument changes, or wrapper response.

## Remaining pre-evaluation and acceptance gates

At final admission, independently rehashed all 110 baseline and 112 candidate manifest entries against snapshot bytes, all baseline entries against parent-commit blobs, and all candidate entries against current worktree bytes: no mismatches. Only KeyboardLayout.swift and KeyboardController.swift differ among production Sources entries. Both copied executors, App.swift and localized Info.plist files match the master driver manifest. Master driver/project manifest hashes also match. Both native variant project.yml files and generated project.pbxproj files point to their own intended source snapshot and not the other variant. Variant bundle identifiers are distinct. Test files were hashed for integrity without reading their contents.

This admits the frozen source/driver/configuration copies. Before evaluation, build each variant from those projects and retain the resulting xctestruns/build provenance; source hashing alone does not prove an already built binary matches source. The wrapper checks snapshot and copied-executor hashes and freezes input/reference/oracle/driver/orchestrator hashes. Final proof must verify them again and independently verify copied App/Info/project/configuration integrity. No smoke results or v2 benchmark inputs/outputs were reviewed here.

Use the disposable v2 host identity/storage and retain proof that observers are nonvacuous. Existing shared language/personal storage can persist across rows/processes; actual policy/count/dirty observations and the separately reviewed positive control are necessary. Resource bytes/hash attest actual dictionary files; nonempty requested-language native stack observations must additionally pass. No lifecycle-wide privacy claim follows from ungated post-disappear diagnostics.

Fresh authoring must receive only the frozen public contract/protocol/schema. V1 raw/gold remains unchanged and rejected. All failed, unchanged and unavailable v2 workflows must stay visible with no favorable subset. The independent oracle and all frozen artifacts must be reviewed before final acceptance. Actual installed menu behavior, secure-entry behavior and sensitive content types beyond oneTimeCode, live locale transition and arbitrary touch gestures remain outside this restricted paired workflow evidence.

## Reviewed artifact SHA-256

| Artifact | SHA-256 |
| --- | --- |
| contract.md | 84879ab17a81b69117af2c0276f56839e102a938d335c39a305cc437d3a32da5 |
| public-protocol.md | 749275a4054addb79c2de1e611e7c9b3142a1aa565981b8a39382d68a00aa838 |
| oracle-schema.md | 05e15b5341606d613bf1e9a7887151db51a894e7f20b28710c9d73e880e3f72b |
| source-manifest.json | dc9e076a2edfd6d0e614a314114656ea81c509ef36d465f0a4b75552fbaf4303 |
| native/R43Executor.swift | 4754785a4ceaa15f22477c390a5c8d75969356fc9ef3bba3e5683ce3a84253d4 |
| run-paired.py | bbf668c12214fe6ebb011728e9714efc9d7119ca59c8b14aa60f5665ed5ac6dc |
| native/project.yml | f816f47a0c13c6e22f345327018126eb077029c7fddd4c419318673d1a283778 |
| native/App.swift | 02098c7587dbb4450ee2b9aa5fc70b5c33eafd8a189aa37074752b5fe32759ad |
| native/Info.plist | 7618f8c6425a85d8e84c3d3f9abe2ae0eb955801b3d6c02d5e81c4d02140fcf8 |
| native-baseline/R43Executor.swift | 4754785a4ceaa15f22477c390a5c8d75969356fc9ef3bba3e5683ce3a84253d4 |
| native-baseline/App.swift | 02098c7587dbb4450ee2b9aa5fc70b5c33eafd8a189aa37074752b5fe32759ad |
| native-baseline/Info.plist | 7618f8c6425a85d8e84c3d3f9abe2ae0eb955801b3d6c02d5e81c4d02140fcf8 |
| native-baseline/project.yml | 5d80578b8b458d2078d4620b8ec4a5d6f60f007e9dc502a28764cc9e955e4bb4 |
| native-baseline/R43Native.xcodeproj/project.pbxproj | f568eed66899fed91ab10f1aec770939fd1d794b983fff024f8a04cbbfe919b5 |
| native-candidate/R43Executor.swift | 4754785a4ceaa15f22477c390a5c8d75969356fc9ef3bba3e5683ce3a84253d4 |
| native-candidate/App.swift | 02098c7587dbb4450ee2b9aa5fc70b5c33eafd8a189aa37074752b5fe32759ad |
| native-candidate/Info.plist | 7618f8c6425a85d8e84c3d3f9abe2ae0eb955801b3d6c02d5e81c4d02140fcf8 |
| native-candidate/project.yml | 0dd4e6cb54676ebf9b8d2c464636ed6e7c3b7e9cd773931ee622ae44094ee752 |
| native-candidate/R43Native.xcodeproj/project.pbxproj | 300dd7b391218b7751186cd3022db4b5ea50ebdadbe347fe29963aa0968508fd |
| apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Layout/KeyboardLayout.swift | 0001873a89ec6e02351c8f2847d68e1dcd921af80e61d7df02d19aa6e8e1554c |
| apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardUI/KeyboardController.swift | e37cf878c95e122448f5c22f3bef8d1dea99d2284edab79b8b06922b0777f621 |
| apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardUI/KeysView.swift | 671ea47eba2716cf6ae3e57777d677264c428836c31ab1113c0f0ded59f2cb7a |
| apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardUI/KeyboardHost.swift | e8b46cb05a13b07742769fadf9ade504904b21f2729f31e0f96b485706c87190 |
| apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Input/InputTraits.swift | 018d9125d75d032c6f71ed58028bb506c26ea5240245510d4d621f489b2cf790 |
