# R43 independent domain addendum — existing landscape constraint

This addendum supplements, and does not edit, the frozen domain review. No repository source, tests, resources, audits, or implementation artifacts were read. Additional geometry and scope facts below were supplied by the parent agent and remain unverified here.

## Additional supplied facts

- Existing landscape key caps are 32 points high with 6-point inter-row gaps; an interior digit hit row may occupy approximately 38 points vertically.
- Existing portrait caps are 43 points high with 11-point gaps, yielding approximately 54-point interior hit rows.
- R43 is limited to numeric layout and narrow controller synchronization. Increasing the whole keyboard's height is outside this change.
- Bottom-row items use .75 of a column pitch, with a gap deducted from each cap width, while the upper three-column digit rows remain unchanged.

## Clarified decision

**Accept preserving the existing landscape vertical geometry as a bounded R43 improvement, provided the change introduces no additional target-size or hit-routing regression.** The existing sub-44-point vertical metric is a known retained usability limitation; it is not, by itself, a blocker to this narrowly scoped locale-separator and required-globe repair. Requiring the patch to enlarge the entire keyboard would expand its scope into an existing layout constraint.

This accepts the incremental change, not the proposition that a roughly 38-point target meets a 44-by-44-point guideline. Wide numeric controls do not compensate for a short vertical axis. The initial review's unconditional full-usability threshold remains unchanged: any claim that all targets meet 44-by-44 points, or that compact/landscape native usability has passed, is blocked by this metric until separately resolved and demonstrated.

[Apple's button guidance](https://developer.apple.com/design/human-interface-guidelines/buttons) recommends at least 44-by-44-point hit regions as a general rule. It does not establish that every pre-existing short keyboard row must be redesigned before a focused repair can be accepted. Treating preservation as acceptable patch scope is this reviewer's engineering judgment, not an Apple exemption or a native usability finding.

## Conditions for bounded acceptance

1. Preserve the existing upper digit rows, keyboard height, and usable vertical hit extent; do not reduce an existing roughly 38-point landscape target to the visible 32-point cap merely to add a globe.
2. Demonstrate actual horizontal fit and sufficient non-overlapping width for every new bottom control at the supported minimum inner span. Preserve 44-point width wherever the available span permits. A newly introduced horizontal deficit is not covered by accepting an existing vertical deficit.
3. Keep separator, required globe, zero, and delete visible and independently operable. Do not trade away document correctness or input-mode switching to fit them.
4. Disclose both visible cap dimensions and actual hit dimensions. The supplied landscape 38-point figure is an interior pitch, not proof of each bottom-row hit target: top/bottom edges, clipping, and routing can reduce it. A 54-point portrait pitch likewise does not establish bottom-row height without checking its actual bounds.
5. Retain the evidence separation in the original review: model/layout, hosted UIKit callbacks, native hit geometry, and installed system keyboard-list behavior are distinct claims. Successful hosted callbacks cannot waive a failed or untested installed menu.

## Pitch clarification

The supplied pitch-based formula addresses the original review's overflow concern in principle. If the complete row consists of three column pitches, four items can each occupy .75 pitch; deducting the appropriate gap from each cap can keep the visual caps within that span. This differs from multiplying an already gap-reduced digit cap width by .75 and adding three additional gaps. Neither formula proves the real hit rectangles, outer margins, or edge routing without measurement. This addendum accepts the stated pitch interpretation as geometrically plausible and makes no source-level assertion.

Recommended reporting: “R43 adds region-locale decimal entry and the required numeric globe while preserving the existing keyboard dimensions. Landscape retains approximately 38-point interior hit rows, below Apple's general 44-point target guidance. Native hit bounds and installed switch-menu behavior are separately reported.” Replace the approximate metric with observed bounds when available; do not describe a supplied pitch as a measured target.

Final status: **bounded R43 improvement accepted in principle; existing sub-44-point landscape height explicitly retained; no blanket usability or native pass.**
