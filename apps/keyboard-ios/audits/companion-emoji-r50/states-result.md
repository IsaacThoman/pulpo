# Real permission-state old/new witnesses

Same final `SettingsInstalledRouteR50Tests.swift` fixture (`15e8f711`, SHA-256 in installed-fixture.sha256), normal ad-hoc simulator signing, actual Settings switches and installed keyboard appearance. No synthetic heartbeat or permission-default mutation. Both builds succeeded. Old exact fc85f84b production source vs final b90093fe + 41abf982 production source.

- Old `old-states.xcresult`: **0 pass / 2 fail / 0 skip**. Both fail at “Public settings request left Setup Guide covering settings”.
- New `new-states.xcresult`: **2 pass / 0 fail / 0 skip**, no runtime warnings. Actual settings language picker interaction and guide reopening pass; all three statuses remain equal to their initial values.
- Completed state: **Done / Done / Done**, with guide intentionally still displayed before the request.
- Full Access off state: **Done / Off / Done**, confirmed by the installed extension and real OS switch.

For BOTH cases on BOTH source versions, the recorded route binding is **real public OS URL fallback** (`XCUISystem.open(pulpokeyboard://settings)`). The installed Keyboard Settings menu button exists in the hierarchy but is not hittable; screenshots show a clipped/blurred menu. The fixture preserves menu screenshots/hierarchy and an explicit binding attachment. No coordinate tap, public custom-action dispatch, or internal route callback substitutes for the installed settings menu. These are public OS URL witnesses from real completed/off guide states, NOT verified installed-menu dispatch.

Initial attempt before the explicit fallback: `old-installed.xcresult`, **0 pass / 0 fail / 2 skip**. These skips remain in results/old-installed-unavailable-* and are not relabeled green. The initial OS setup availability probe separately passed 1/1 and established that the keyboard and permission switches were offered. Control availability, route origin, and actual permission confirmation are distinct observations.

Paired screenshots, hierarchy, and binding text: witnesses/states-old and witnesses/states-new. Unhittable menu evidence: witnesses/installed-menu-unavailable. Structured summaries: results/old-states.json and results/new-states-summary.json. No blind or spoken VoiceOver claim.
