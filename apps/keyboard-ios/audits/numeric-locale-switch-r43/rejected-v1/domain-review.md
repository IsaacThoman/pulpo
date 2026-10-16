# R43 independent domain review — frozen before implementation

Review basis: only `/tmp/pulpo-r43-v1/contract.md` was read locally. No repository source, tests, resources, prior audits, implementation artifacts, or native results were inspected. This is a design/domain assessment, not an implementation or native acceptance result. Parent specified by contract: `b5451e4211f0aa735233d5de8b98b5708c0e8a0d`.

## Decision

Accept a **bounded four-control bottom row** as a reasonable design direction, conditional on gap-aware fitting and measured usable hit targets at the actual supported minimum widths and heights. Keeping the upper nine digits in three columns is appropriate. Making separator, required globe, zero, and delete simultaneously visible avoids hiding essential numeric entry or the keyboard escape path behind a mode toggle.

This is **not unconditional compact-width approval**. The contract does not specify a minimum supported inner width, row height, margins, or spacing; no such values can be inferred here. Under-size or overlapping targets in a supported mode are a domain blocker to a usability pass. Native menu behavior and installed extension usability remain unproven regardless of core geometry or hosted callback success.

## Locale and numeric entry

Foundation locale supplies cultural formatting conventions, including its decimal separator; typing language selection is a different concern. The contract's independence from EN/ES/BI is appropriate: changing prose language must not determine decimal punctuation. Use the region locale value at a real refresh; label, accessibility description, and literal inserted text must agree. Preserve period and comma and do not silently assume those are the only legitimate locale symbols. A valid Foundation decimal separator must not be rejected merely for being non-ASCII. Missing, empty, malformed, whitespace-only, or otherwise non-insertable values require a deterministic period fallback under the contract. If the implementation restricts validity, that restriction needs an explicit supported-domain justification.

The period fallback is defensive behavior, not evidence that the host will parse every fallback value. Entry should remain literal: do not add separators to ordinary number-pad layouts, reformat surrounding numeric text, learn prose from numeric/private input, or change digits and deletion as a side effect of switching keyboards. A locale change becoming visible only at an actual controller refresh is an accepted bound; immediate live updates are outside this contract.

Primary reference: [Apple Foundation Locale](https://developer.apple.com/documentation/foundation/locale) describes locale conventions and the locale decimal separator. [Apple NSLocale decimalSeparator](https://developer.apple.com/documentation/foundation/nslocale/key/decimalseparator) identifies the associated separator, with period and comma as examples.

## Required globe behavior

When `needsInputModeSwitchKey` is true, the numeric layout needs a visible, discoverable, tappable keyboard switch control with an understandable accessibility label. It cannot be substituted by an in-app EN/ES/BI control, hidden on a secondary layout, or assigned text insertion. When false, the layout need not add its own globe; do not treat the absence of a custom globe as a failure in that case.

A native touch interaction should preserve the system keyboard-list behavior as well as tap advancement. Apple documents routing the switching button's touch events to `handleInputModeList(from:with:)`, with all touch events allowing the long-press picker. Accessibility activation should retain a reliable switch action. Check that no punctuation or zero is inserted, no deletion occurs, and the document is unchanged by either switching route. A unit callback or a hosted controller is insufficient evidence that the installed system keyboard menu opens correctly.

Primary references: [Apple needsInputModeSwitchKey](https://developer.apple.com/documentation/uikit/uiinputviewcontroller/needsinputmodeswitchkey), [Creating a custom keyboard](https://developer.apple.com/documentation/uikit/creating-a-custom-keyboard), and [handleInputModeList(from:with:)](https://developer.apple.com/documentation/uikit/uiinputviewcontroller/handleinputmodelist(from:with:)). Apple explains that some devices provide a system globe below the custom keyboard, making this property false.

## Width, spacing, and 44-point targets

Apple's general iOS button guidance is a hit region of at least **44 × 44 points** with enough separation for reliable selection. This is a usability target, not proof that a particular keyboard is native-verified or a statement about App Store approval. Points are logical iOS units; pixel counts, icon size, fractional layout weights, and screenshot appearance cannot establish that threshold. The actual interactive target matters, including clipping, overlap, content insets, ancestor bounds, and which view receives edge taps. Accessibility frames and identifier presence alone do not prove a touch target.

Let `S` be the available horizontal span inside the outer row margins, and `g` the actual gap between adjacent controls. Four equal controls need width `(S − 3g) / 4`. Meeting 44-point width therefore requires `S ≥ 176 + 3g`; row target height must independently be at least 44 points. At `g = 6`, the threshold is `S = 194`. Illustrative inner spans, not device claims:

| Inner span S | Each of four widths, g=6 | Width outcome |
| --- | --- | --- |
| 320 pt | 75.5 pt | Above 44 pt |
| 240 pt | 55.5 pt | Above 44 pt |
| 200 pt | 45.5 pt | Above 44 pt, little slack |
| 194 pt | 44 pt | Exactly the threshold |
| 180 pt | 40.5 pt | Below 44 pt |

The `.75` proposal must be interpreted carefully. If an existing digit key is `(S − 2g) / 3`, assigning each bottom control literally `.75` times that width yields four controls plus three gaps totaling `S + g`: it overflows by a gap. Fractional weights can work if the layout solver distributes the actual row span across four items after deducting three gaps. Therefore `4 × .75 = 3` in abstract column units does not establish on-screen fit.

Extending hit regions into unused space can help only when the resulting targets remain unambiguous, non-overlapping, and inside the interactive region. Overlapping invisible targets, clipped regions, or cross-row hit zones do not resolve insufficient space. Four 44-point side-by-side targets cannot fit in an inner width below 176 points even with zero gaps.

Primary reference: [Apple Human Interface Guidelines: Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons).

## Compact, one-handed, and landscape assessment

- **Minimum width:** determine the actual supported inner row span after margins, safe-area handling, and every compact layout transform. Measure the resulting four targets; exercise centers and points near each shared edge. A convenient full-width portrait measurement does not cover the narrowest supported configuration.
- **One-handed or floating widths:** if the OS or app can present them, treat the actual reduced custom-keyboard bounds as input. Reachability can improve while target width becomes worse. Do not assume that a nominal phone screen width is available to the row, or that every installed OS supports the same custom-extension presentation.
- **Landscape:** extra screen width may help horizontal fitting, but safe areas and a centered/capped keypad can keep S small. Reduced vertical space may shrink row height below 44 points. Inspect both dimensions, bottom clipping, and globe list interaction at the actual landscape bounds.
- **Motor and visual use:** four controls differing from the upper three-column alignment are a modest discoverability cost, acceptable if labels/icons remain clear, presses have feedback, and the controls are consistently ordered. A row ordered separator/globe/zero/delete shifts zero off the three-column center; that is a learnability risk, not an automatic blocker. Confirm zero remains easy to find without destabilizing the ordinary number pad when a globe is unnecessary.

These are inferred design risks and acceptance conditions, not observations about the current code or devices.

## Alternatives considered

1. **Four equal controls within the existing row span:** best bounded option where both target dimensions pass. It preserves four immediately visible actions and avoids shrinking only the less visually prominent globe. Use actual gap-aware geometry.
2. **Separate globe/accessory row within the same horizontal span:** viable below the four-target width threshold if enough vertical space exists and the contract permits an added row. Preserves a centered zero in the ordinary bottom numeric row. Costs keyboard height and may fail landscape height; it needs its own measurements.
3. **Split the first digit-width slot between separator and globe, retaining centered zero and delete:** visually familiar upper alignment, but the two split controls become narrower than four equal controls. It is a worse minimum-width solution and needs separate 44-point checks.
4. **Move globe outside the keypad span:** potentially usable but violates the stated span unless that contract is explicitly revised. Relying solely on the OS globe when the host property is true is unacceptable.
5. **Hide separator or globe behind long press, share an ambiguous dual-action key, remove zero/delete, or alter the upper digits into four columns:** conflicts with visible essential actions or preserved entry expectations; reject for this contract.

If a supported width or height cannot meet the accepted bounds, use an adaptive alternative that retains all required visible controls, or explicitly limit the supported configuration. A blanket compact-usability claim is blocked until that decision and its evidence exist.

## Evidence required after implementation

Separate claims and artifacts for (a) locale/control model behavior and span calculations, (b) hosted UIKit controller paths and accessibility activation, (c) actual native target bounds and edge hit routing at minimum/compact/landscape sizes, and (d) the installed OS extension's switch menu and end-to-end entry. Show literal locale punctuation, digits/zero/delete, no document changes from the globe, unchanged ordinary text and number-pad entry, and visible failures for unsupported actions. Do not relabel hosted tests as installed extension evidence.

Apple states that phone-pad and name-phone-pad fields use the system keyboard; hosted custom phone tests can validate a branch but cannot establish installed custom phone usability. Source: [Configuring a custom keyboard interface](https://developer.apple.com/documentation/uikit/configuring-a-custom-keyboard-interface). System fallback for those fields is an acceptable explicitly reported limitation under this contract.

Final domain status: **conditionally accepted design; native targets, supported minimum bounds, installed globe menu, and actual device usability remain unverified.**
