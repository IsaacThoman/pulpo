# REJECT — R20 right-side external insertion

Retain this experiment as reproducible evidence, with no production spacing change. The original implementation audit is preserved verbatim as [agent-audit.md](agent-audit.md). Its historical statistics remain valid; its rejection rationale needs the distinction below.

The existing `AccuracyEditingTests.pendingCursorMovePrecedesTranscriptCapitalization` assertion expects `Hello againA note. please ` after moving the cursor to the document start and inserting the transcript `Hello again`. The rejected candidate instead produces `Hello again A note. please `. It preserves cursor reconciliation, capitalization and original host text. This is an old API/oracle compatibility conflict, not by itself proof of worse user behavior: under R20's proposed natural-phrase contract, the separator is preferable. The existing test's capitalization focus does not establish that fused words were an intentional product requirement. The frozen round nevertheless forbade changing executable control expectations, so its procedural rejection remains intact. Do not promote or retune that rejected round.

There are concrete product costs beyond that oracle conflict. The retained source-derived controls expose new misplaced spaces in rows that already failed the exact oracle:

| Control | Baseline actual | Rejected candidate actual | Frozen expected |
| --- | --- | --- | --- |
| `s19`, smart punctuation disabled, then comma | `Bring fresh,supplies` | `Bring fresh ,supplies` | `Bring fresh, supplies` |
| `s20`, then `?!` | `Bring fresh?!supplies` | `Bring fresh? !supplies` | `Bring fresh?! supplies` |

The baseline already misses a right separator, but the candidate additionally detaches punctuation. Reusing the existing automatic-space state handles the first punctuation character under normal settings; disabling smart punctuation or typing another punctuation character exposes these costs. Both rows remain failures, so a pass-to-fail counter reports zero regressions while missing their degraded outputs. This is substantive evidence against retaining this exact candidate. The verifier reports changed failed rows separately; it does not reinterpret all changed failures as improvements or losses automatically.

Original exact full-document **and caret** results, unchanged:

| Workload | Baseline | Rejected candidate | Accounting |
| --- | ---: | ---: | --- |
| Frozen development | 23/40 | 35/40 | 12 gains, 23 passes, 5 unchanged failures |
| Independently authored held-out | 15/35 | 28/35 | 13 gains, 15 passes, 7 unchanged failures; one additional unscored ambiguity, 36 total |
| Source-derived controls | 12/21 | 18/21 | 6 gains, 12 passes, 2 changed failures, 1 unavailable; one additional changed ambiguity, 22 total |

The source-control ambiguity `s11` changes `fooBar` to `foo Bar`; neither intention is established by the smart API's observable inputs. The held-out ambiguity is unchanged. The unavailable source row `s10` used an unsupported backspace escape in its test encoding; `s21` separately exercises actual engine Backspace. No unavailable production Backspace API is claimed. Old R5 replay remains exposed evidence only: development 25/28→27/28 and former held-out 19/22→20/22, with one unavailable completion in the latter. No R5 result is a new blind gain.

Every R20 execution uses the actual **bilingual `en_es.pkdict` stack**. English, Spanish and mixed text do not constitute three selected language-mode runs. The frozen schema omitted mode; the original scope documents that interpretation before reveal. The 36 held-out inputs preserve the original sealed hash; all source/runner/oracle bytes stayed frozen during the one baseline/candidate evaluation. These cases are now exposed and cannot serve as a future blind workload.

The candidate affects only opted-in `spacing: true` insertion, reached by actual `insertTranscript` after its trim/casing. A visible left boundary, visible/reconciled right context, a permitted Latin/Spanish letter-shaped payload and `policy.autoSpaces` gate its appended ASCII space. Its one insertion primitive replaces a selection once and leaves suffix bytes intact in the recorded host model. Raw/literal calls and default emoji routes retain their right-side joins; existing owed swipe spacing on the left remains intentional. The shape filter cannot recognize prose or all technical fragments, and private/restricted, hidden-context, quoted/terminal-punctuation and opener payload cases retain documented misses.

The exact rejected patch is inactive. Original production was restored byte-for-byte to engine SHA-256 `3f0987051ff0f176a5e1ef6396d415b0f8fe0fc2088735c75fef87f75158de97` at `f9f8d58c`, matching baseline `f17109e7`; this was independently checked from both committed blobs. The final original range adds no production change. Full-gate records preserve 439 core + 3 service tests passing on baseline/restoration with five known core issues; the rejected candidate adds the one unexpected exact-output failure described above. This retention adds no Swift test discovery, runtime/compiler changes, dictionary data, or ranking policy.

Native controller guards still reject private/selected transcript destinations; direct engine cases do not prove those delivery paths are reachable. Other UIKit delivery, arbitrary asynchronous host intervention, UTF-16 caret behavior and native host Undo grouping were not tested. Engine Backspace is not host Undo. A single insertion primitive and the synthetic queue model support only their recorded ordering and conservation claims. Old engines, privacy guards and model state are not altered by these artifacts.

A future, separately frozen round should define phrase-versus-literal boundary intent explicitly, adjudicate legacy fused-word oracles before freezing, and include punctuation runs/settings, supplied whitespace, ambiguous joins, selection/caret/Backspace and real controller delivery. R20's revealed examples may become exposed controls, never fresh evidence. No successor spacing policy is selected here.

Artifact retention independently verified all original/decompressed hashes, ordered case/report identity, bilingual-only labels, typed scores/status, exact output/caret flags, outcome counts and every R20 primitive/selection/conservation trace. Historical scripts and audit remain byte-exact evidence, not hardened validators. The bounded [verify.py](verify.py) uses explicit failures and does not rely on Python assertions. No builds, inference, simulator/device operations, deployment or push were performed for this retention.
