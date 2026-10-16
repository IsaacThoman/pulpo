# Compact UIKit layout and interaction audit

Baseline: e1865f3f, PR782, isolated t3/compact-keyboard-ux checkout. Production fixes: 5c7aac7d and f97f5287. No push, physical deployment, parent checkout edits, core text/suppression changes, or app navigation/draft-retention changes.

## Decision and evidence

Retain two small general fixes. The root previously redirected the lower seven points of even enabled bar controls into the letter grid. Real XCTest taps at 94% of the language and microphone control height failed to present their intended UI on baseline and pass after the routing fix. Enabled UIControl ancestry now preserves UIKit's original hit target. Background, disabled suggestion slots and ordinary grid gaps continue to forward.

The third suggestion also extended two points into the language control. Broader development probes found 75 misrouted right-edge samples in 15 compact/docked cases after the first fix. Slots now end at the actual language-control edge, with deletion/Undo content using that same available region. Mic-visible and mic-hidden layouts are covered. No letter-key minimum size, feature disablement or special case per device/language was introduced.

Freeze sequence: b8c2a930 freezes 27 development inputs and protocol before relevant implementation inspection. A separate author commits twelve fresh inputs at c28a2e48 without reading source, development cases or outcomes and without a simulator. 8f71c407 freezes the first routing candidate before fresh inputs are read. 24bb0ff3 freezes both production fixes before any fresh execution/outcome. Subsequent changes only harden the test host and reports; production remains frozen. Fresh execution uses runner f52628e6.

## Executed matrix

Production HarnessKeyboardViewController subclasses PulpoKeyboardViewController with a simulated text proxy; production KeyboardController, root, bar, KeysView, key caps and emoji/search/dictation panels run in a real UIKit window. A clipped host envelope uses the frozen dimensions, while the root follows its production preferred height after width-driven layout. Reports record root bounds, actual safe-area insets, active control identities and unavailable docking. Layout matrix safe areas are zero; this is not device-safe-area/physical-rotation evidence.

Development: **27/27 cases, 151,608 gates, zero failures.** Independent fresh inputs: **12/12 cases, 69,004 gates, zero failures.** The common executable sequence checks enabled control hit targets at 25 interior/near-edge points; every visible key at nine points against the grid and intended key; representative actual UIKit letter/delete/space/return input; number/symbol/letter round trips; emoji picker/search/back/letters; query isolation; side move/expand/redock where available; exact word-delete Undo restoration; mic-hidden presentation; disabled/background forwarding; dictation-message geometry; and final typing restoration. The fresh rotation case reflows an open production panel to 812-point landscape and back; the live accessibility case checks utility controls across normal/accessibility trait changes.

These are assertion gates, not independent people, gestures or statistical samples. The frozen prose scenarios are broader than the common executable sequence. The runner decodes `scenario` for provenance but does not interpret each sentence: not every case-specific phrase, accent entry, language-menu opening sequence, caps-lock action or action at every sampled point is executed. Most samples establish exact hit routing, and production actions run separately. Real XCTest methods supplement this with actual lower-control events; neither technique proves every sampled target's end-to-end action. Existing native alternate/shift tests supply separate regression evidence, without turning the unexecuted fresh prose into passes.

## Failed gates and test-host corrections

All failed hit-gate signatures and their per-case indices are preserved in the small JSON reports, not dropped from averages:

- Initial baseline: 27,801 gates, 486 failures; lower language/mic regions.
- Expanded baseline: 34,968 gates, 1,782 failures; language/mic, empty-bar Settings, search Back, Undo. Both actual lower-control XCTest methods fail. Finalized commands exit65.
- Routing-only development: 52,410 gates, 75 failures; two-point last-slot/language overlap. 76/78 methods pass; existing installed picker fails with Apple's keyboard active before setup.
- Initial final-candidate host run: 148,314 gates, nine landscape height-envelope failures. The frame-based test host still had its initial 244-point portrait height after width-driven production style became landscape. It now applies the controller's new preferred height after the layout callback, matching the host contract. This fixes the test host, not product metrics or frozen envelopes. Both actual control methods and assigned-simulator extension setup pass in that run (3/4 methods).
- One compilation attempt fails because a generalized UIControl probe accessed UIButton.currentTitle without a cast; corrected in test code, no tests executed. An XcodeGen invocation from repository root fails to find project.yml and is rerun with the explicit apps/keyboard-ios spec. Early result-reader attempts precede bundle finalization; they are not product failures.

The original search layout test asserted that the Back button's lower area typed q. It now requires that area to hit Back. That changed expectation is necessary to the user-facing bug fix, and separate input/background-routing regressions remain enabled.

## Source review

An independent read-only review finds no concrete production regression: enabled-control ancestry preserves the original UIKit target; the existing side-panel, notice/panel, disabled-slot and background behavior remains intact. For the bar calculation, visible-mic slots end at width−96 and hidden-mic slots at width−50, exactly the language control's leading edge. It identified empty-control skipping, weak Undo checks, missing edge/height/live-trait/mic-hidden coverage and the difference between hit testing and action execution. The runner hardens the first group, while the latter limitation remains explicit above. No generated outcomes were read by that reviewer.

Intentional suggestion truncation and fixed native keyboard text metrics are not defects here: controls retain full accessible labels, and no lost meaning was proved. Largest accessibility content size is injected as accessibilityExtraExtraExtraLarge; bold uses legibility traits plus the actual production KeyboardStyle(bold:) path. This does not verify toggling system Bold Text, Dynamic Type font scaling, VoiceOver speech, human comfort or reachability on a physical phone.

## Environment and reproducibility

Assigned simulator only: iPhone18Pro 7E1D7979-7307-4C53-8466-BB41154B383C, iOS27. T3 device_list and device_open both return `Device list failed: The device command failed (exit code 127).` No agent-device host/session flags were returned. Use the documented README XcodeGen/XCTest/CoreSimulator fallback; the live Device panel could not be opened. The device was already booted when simctl boot was attempted. Prepare only this device with scripts/simulator_keyboard.py; no other simulator is driven.

Generate using `xcodegen generate --spec apps/keyboard-ios/project.yml`. From apps/keyboard-ios, all runs use `-project PulpoKeyboard.xcodeproj -scheme PulpoKeyboard -destination 'platform=iOS Simulator,id=7E1D7979-7307-4C53-8466-BB41154B383C' -derivedDataPath /tmp/pulpo-compact-ux/DerivedData -parallel-testing-enabled NO -collect-test-diagnostics never`. Outputs stay under /tmp/pulpo-compact-ux. Set `TEST_RUNNER_PK_COMPACT_REPORT='/tmp/pulpo-compact-ux/verified-{phase}.json'`. Select CompactLayoutUXTests for both matrices, CompactLayoutInteractionTests for real preview events and CompactInstalledInteractionTests for the installed menu. KeyboardSetupTests ran first in a separate completed command. The final run also selects KeyTouchTests, ShiftTouchTests, AlternateStripTests, OneHandedLayoutTests, EmojiSearchLayoutTests, EmojiPanelTests, PhonePadTests, InstalledKeyboardGeometryTests, KeyboardLanguageTests/testSwitchesTypingAndSwipeLanguageWithoutLeavingTheKeyboard, and OneHandedTests/testDockedTypingSwipingAndSideControlsInPreview.

Build logs are inspected only after nonzero command output. No raw screenshots, build logs, result bundles or corpora are in Git. execution-costs.json retains finalized command/test counts and output-file timing estimates; it is not a CPU/energy/memory profile. The parent-reported core/service/tooling results and known core/installed-AX issues are inherited context, not rerun or resolved by this UIKit scope.

## Native outcomes and remaining limits

The combined final command completes with **82/83 methods passing**, zero skips, and exit65. Both matrix methods, both real preview lower-control event methods, all selected native touch/shift/alternate/one-handed/search/emoji/phone-pad regressions, installed geometry taps and multi-point swipe, the real language-switch workflow and docked preview workflow pass. The existing installed-picker viewport method also passes after setup; its earlier failure is retained above.

The new CompactInstalledInteractionTests/testInstalledLowerLanguageControlPresentsMenuAndRestoresTyping initially cannot find the Spanish menu choice after a geometry tap. It remains a recorded failed gate. A diagnostic-only change adds a post-tap screenshot and compares the empty field against its actual initial value (including placeholder semantics), before retaining the same menu assertion. A standalone rerun passes fully: the simulator screenshot visibly shows the native Typing Language menu with English, Español and bilingual choices; selecting Spanish and then typing Q succeeds. Menu availability was computed before taking that screenshot, so the screenshot did not turn a false menu result into a pass. No production change follows the first fresh run. The first failure's precise cause remains unproved; do not characterize it as a confirmed permanent AX block or a product regression.

The existing iOS27 remote AX omissions and parent known installed-AX/core issues remain limitations outside this fix. Installed geometry/input success is not proof of extension-key VoiceOver exposure or successful coverage of every installed control. No tests are disabled or silently skipped to claim a clean suite.

One independent author also performs two read-only reviews. Exact agent/token, memory/energy and physical-human costs are not measured. Command/test timing estimates are in execution-costs.json. The final isolated command uses `-test-iterations 3` for that same installed method and exits0: all three repetitions pass (16.89s, 15.49s, 15.47s). This supplements the 82/83 combined result; it does not retroactively make that command green. The exact first-failure cause remains unresolved.

Total recorded build/test command time is approximately 8.8 minutes from output-file creation/update times; timing metadata is approximate and includes overlapping infrastructure effects, not a human-effort estimate. All commands finalize with diagnostics collection disabled; none requires termination for a finalization stall.

Simulator ownership is released after these serialized commands finish. iPhone18Pro 7E1D7979-7307-4C53-8466-BB41154B383C remains booted with Pulpo enabled and Full Access set by setup. The test ends after Spanish menu selection and Q input. iPhone17 and E1C6B89D are never driven. No physical device is used, nothing is pushed, no parent checkout is edited, and no background simulator command remains active. PR782 is registered with the thread and is not watched.
