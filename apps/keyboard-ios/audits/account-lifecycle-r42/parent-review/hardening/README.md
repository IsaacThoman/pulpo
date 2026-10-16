# Derived R42 audit helper hardening

This derivative fixes audit input coercion only. Account source, frozen fixture, expected values, original helper, six original malformed-report probes/results and all raw evidence remain unchanged. Original helper bytes are preserved in original-verify.py.txt (SHA2565a23926c81a9599ee6b5bba780cbcd5236062679d63142bfa278385af527ed9a); verify-hardening.patch shows the complete derivative diff.

The original helper accepted checkpoint memory.dictation=0/1 in place of a Boolean because Python dictionary equality equates bool/int. It also accepted disposition.released="false" as truthy. The derivative requires exact checkpoint state/snapshot fields, nullable strings, Boolean dictation/signedIn, and Boolean reserved/released/cancelled flags. The existing strict checkpoint pass-flag check remains. These checks cover the identified and adjacent actual-format Boolean fields; they do not make this a complete strict schema verifier for all events, tasks, counters or request semantics.

Explicit packet discovery is the only path change. Set R42_PACKET to the immutable R42 audit folder; no stored artifact/device/binary is executed. The original helper's original-source seal check still reads historical R35 checkout files when present or falls back to historical Git blobs. Therefore historical Git objects must be available if those checkouts are absent. This verifies original R35 source provenance, not current imported production bytes. Readiness cannot be inferred from this helper alone.

Example (replace the packet path after parent import):

```sh
export R42_PACKET=/Users/isaacthoman/.t3/worktrees/pulpo/t3-5890fa78/apps/keyboard-ios/audits/account-lifecycle-r42
python3 -B /tmp/pulpo-r42-parent-hardening/verify.py
python3 -B -O /tmp/pulpo-r42-parent-hardening/verify.py
python3 -B /tmp/pulpo-r42-parent-hardening/historical-probes.py
python3 -B -O /tmp/pulpo-r42-parent-hardening/historical-probes.py
python3 -B /tmp/pulpo-r42-parent-hardening/probes.py
python3 -B -O /tmp/pulpo-r42-parent-hardening/probes.py
```

Both modes produce byte-identical original verdicts (candidate24 pass; baseline14 pass/9 fail/1 unavailable), identical historical six-probe results, and identical21 new rejection results. New probes mutate in-memory copies only: numeric0/1 or stringfalse for memory/persisted/snapshot dictation, snapshot signedIn, and each of three disposition flags. Their input data and gold are never saved into the frozen packet.

Current integration context: unchanged-parent-sources.json remains a historical134-file claim against00b46dd5, not a requirement to undo later work. Independent historical Git199+206 checks and134 parent/worker bindings passed. The published parent's only difference within that old134 inventory is the intentional R38 InputTraits source SHA256b51ff8291e2fc6a64f2244a7ddf198d4a49fde79443bffca500b4d2b317d2b61 (old018d9125…). Do not rewrite the historical snapshot. After import separately hash-check the six imported files using import.json, retain the historical134 comparison against00b46dd5, and check current R38 independently.

All request/save/clear/publication counts in verification JSON commonCounts refer to23 common-operation schedules:100 HTTP each, saves34→28, clear8→5, publish88→79. Across all24 schedules totals are106 HTTP each, saves37→30, clear8→5, publish93→83. No physical storage or latency conclusion follows from call-site counters.

No repository files, native apps, devices, source behavior or oracles were changed. This hardening is suitable as separately labelled parent evidence; do not replace or relabel the historical helper/results.
