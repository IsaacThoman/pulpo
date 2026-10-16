# Independent post-freeze source adversary: reject

The source reviewer confirmed this report and the diagnostic originals complete before curation. This is exposed integration/source-review evidence, not a blind sample. No new candidate was tuned after the result.

Frozen `f3921a48` engine `phraseDestinationMatches` (lines 558–562) requires that the live prefix be nonnil, rather than checking its visible contents against the saved progress. Its post-delete check (299–300) and post-punctuation check (365) can therefore accept a fully visible silent prefix replacement while the document identifier and suffix stay unchanged. This differs from any unobservable old-owned-snapshot ambiguity.

`Client.swift.txt` freezes seven contexts, uses the actual public engine methods and real en_US/es/en_es stacks, and retains every primitive. During `insertCharacter(",")`, the host replaces the complete prefix at a chosen stage with `FOREIGN`, caret 7, suffix `supplies`, same document identifier and no selection. There are 21 baseline and 21 candidate traces.

- Candidate `delete-silent`: replacement occurs immediately after the owned-space deletion. Candidate subsequently inserts comma then ASCII space, ending `FOREIGN, supplies`, caret 9, in all three stacks.
- Candidate `punctuation-silent`: replacement occurs immediately after comma insertion. Candidate subsequently inserts an automatic ASCII space, ending `FOREIGN supplies`, caret 8, in all three stacks.
- Corresponding callback controls stop at `FOREIGNsupplies`, caret 7. Marker-stage mutations have no remaining writes; uninterrupted controls retain their original version-specific expected output.
- Baseline punctuation-stage replacement occurs and receives no later write. Baseline deletion/marker hooks do not fire because baseline creates no owned phrase marker. Do not claim those unavailable hook opportunities demonstrate baseline safety for the same internal stage.

The scripts verify the actual trace chain and post-replacement writes rather than accepting a conservation/safety boolean. Appending to a wrong destination can conserve every original character and still violate the insertion transaction. The older 129 source-control iterations explicitly send callbacks for their interventions; their passing result does not cover these withheld-callback mutations.

All 14 frozen file identities were checked against the final candidate during source review. The diagnostic links an immutable baseline library from `e9f5d6bb` (Core tree byte-identical to R26 baseline `74a4af2d`) and the frozen candidate library. Original client/input/protocol, complete traces, summary, commands and source/library hashes are retained; executable clients are excluded. This curation ran only data/hash/source-history verification, not a keyboard, build or device. Native controller, UIKit interleaving and native Undo acceptance remain unexecuted for this rejected candidate.
