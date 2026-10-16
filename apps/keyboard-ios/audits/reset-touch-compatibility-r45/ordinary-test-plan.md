# Ordinary mechanical checks planned before correction

- Table-driven memory dense40/dense41/dense64 and sparse41 (40 known taps) retain all known finite samples. Check accepted status, weight and all-key finite offsets. No artificial target cap.
- Compatibility expansion: 21 ligature ﬀ characters normalize to 42 letter samples; memory accepts 42, persistent rejects42; with one original tap absent leaves40, persistent accepts and round-trips.
- Seeded persistent model: dense40 and sparse41/long64 with <=40 taps admit, save/reopen matches memory offsets. Oversize dense41/64 rejects, preserves preseeded projection/cache and all authority-family paths/bytes/modification metadata. A later save/reopen cannot replay rejected work.
- Empty/one-letter/tapless/mismatch, NaN/infinity and learning-off reject atomically, including nonfinite tap after otherwise valid samples. Tests start with existing evidence; invalid input cannot clear it.
- Existing secure/password ordinary engine tests remain. Add long private-field controls only if meaningful via normal engine accepted words; no fabricated UIKit long-word claim.
- A long same-letter word with out-of-radius taps checks the start-of-word reference and existing radius using a hand-computed closed form. No mirror reimplementation of learning.
- Standalone original public witness runs under isolated empty working directory to check nilURL learning/save/reset creates no files. Original bytes and results preserved independently of new blind sweep.

Full release core/services, data unittest discovery, frozen source review follow. No resource/performance/device rerun for this narrow guard correction; original limits retained.
