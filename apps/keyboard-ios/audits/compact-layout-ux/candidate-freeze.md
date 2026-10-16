# Candidate freeze

Candidate: 5c7aac7d (production and existing search-edge regression update), test harness 43920374. Frozen before reading fresh inputs or any fresh outcomes. No fresh set has been run.

Baseline original: 27 cases / 27,801 checks / 486 failed hit gates. Expanded baseline: 27 cases / 34,968 checks / 1,782 failed hit gates; both real XCTest lower-language and lower-microphone event tests fail to present the requested UI. Command exit 65, finalized result bundles outside Git. Failures cover language, microphone, empty-bar Settings, search Back and Undo. Other gates passed. Expanded test compiled before the subsequently added side-move/expand checks; disclose that those additional nonregression gates have no red run and did not motivate the fix.

General fix: preserve hit-tested enabled UIControl ancestors before forwarding unused lower bar/background regions to the letter grid. No new per-control geometry or minimum letter size, feature removal, text engine changes, global setting mutations, or harness-only product code.

The old search-row regression deliberately expected a Back-area tap to type q. Update it to require Back to retain that touch. Existing unused/disabled slot and outer grid routing remain regression gates. Candidate validation must include fresh cases, actual XCTest control taps, installed geometry if available, and relevant native tests.
