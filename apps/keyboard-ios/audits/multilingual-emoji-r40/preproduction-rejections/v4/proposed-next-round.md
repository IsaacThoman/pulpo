# Separate round 1 proposal: source-observable C=(T,W)

Status: parent-proposed replacement, recorded only; NOT approved or reviewed as a replacement in round3. No implementation is authorized by this note.

Let T be the orthographic Spanish token set and W the sorted unique WHOLE words from unchanged baseline normalized(raw), INCLUDING ignored words. Define canonical search identity C=(T,W), localized eligibility/ranking from T, and reservation from W. Do not derive W by projection/transport from T.

For the confirmed witness, W(FF9E a)=[FF9E a] while W(apostrophe FF9E a)=[a]. These inputs cease to share an identity. That observation explains the proposed change; it does not prove the replacement.

Proposed E_W:

- B(e): the actual final bounded index keys whose retained postings include e.
- N(e): the sorted unique whole-word set from unchanged normalized(e.name).
- E_W(W) = { e : N(e)==W OR there exist w in W and k in B(e) with k.hasPrefix(w) }.

Use the actual legacy Swift String.hasPrefix; no mark removal, transliteration, scalar exception table, or English substring projection. Keep ignored words in W and in the prefix witness. Specify the empty-W guard explicitly.

The proposed structural argument distinguishes all three actual entry sources: exact-name lookup should imply N(e)==W; direct whole-query collection should imply a retained key prefixes the first whole query word; fallback candidates originate in a per-word collect call. Limits/preferences/ranks remove or reorder members. The next independent round must establish the exact-name implication, canonical equivalence and prefix transitivity/boundaries with actual Foundation/Swift, final bounded postings, guards, all API branches, useful capacity and fixed-C order/repetition behavior. This note does not establish those lemmas, run replacement controls, or approve new normative bytes.

V4 remains rejected. The live repository contract changed to v5 during this review; that revision is outside this round's verdict.
