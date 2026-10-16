R43 does not change R38 InputTraits/privacy/host adapter or R39 Engine/Return behavior.

Exposed V2 row `fresh-v2-16-private-otp-literal-pages` set native `UITextField.textContentType=.oneTimeCode`, remained nonsecure, and reported learning policy `allowed` on standard/page actions in both baseline and candidate. Numeric transitions then reported `disabled`. Text completed literally and no count increase was observed in that row, so leakage and the exact UIKit raw-value/mapping cause are not proven. Actual native content-type/trait capture is needed before any repair claim. Frozen row, both traces and failed oracle verdict remain in `rejected-v2` for R38.

V2 rows 17/18 assumed `UITextField.insertText("\n")` would append newline and reset the punctuation page. The single-line fixture did neither; later `o`/`k` requests were absent. These failures are retained, with no R39 production edit and no universal Return/form-navigation defect inferred. V3 explicitly excludes Return/form navigation rather than silently accepting it.

Installed system switch/menu behavior, an in-process OS locale change, native proxy hidden-context privacy, spoken VoiceOver and physical rotation/performance remain outside R43's hosted evidence. Phone/name-phone and secure-field system fallback must remain explicitly scoped.
