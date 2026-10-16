# Decision before held-out evaluation

Choose unchanged production code at 5b972d2a. No retained correction, selection, or editor implementation change. The held-out results have not been evaluated or read at this decision.

Original development baseline: 70/74 exact, all 28 typo runs correct, 30/32 clean literal runs correct, 12/14 editor runs correct. Baseline failures: dev-023 es/bi (Íñigo changed to Índigo/Indigo); dev-033 es (hello,world changed to bello,world); dev-034 es (foo.bar changed to foto.bar).

One candidate extended the existing title-case name safeguard to explicitly accented sentence-initial words, retaining its transposition/touch exceptions. It scores 72/74 by protecting Íñigo in es/bi, with no original-development regressions. It does not improve the required >=2 typo or >=2 editor development outcomes, so it is ineligible under the originally frozen threshold. No threshold amendment.

The separate post-inspection diagnostic file was frozen before its first execution (18b37607). It is a development probe, not blind evidence. The candidate drops from baseline 22/24 to 11/24: it newly blocks six Spanish and five bilingual title-case doubled-letter repairs. Its two name-protection gains therefore cost eleven observed typo-recovery regressions. Lowercase controls distinguish the title-case safeguard effect. This is sufficient harm to reject the candidate without seeing hold-out.

The rejected patch and development/diagnostic reports are retained as audit evidence only. Production source is restored. The final held-out evaluation will run the fixed baseline and already-built rejected candidate once as a paired audit, with the final no-change decision locked. It will not reopen tuning or change this decision. No Gboard comparison or device work is needed to decide this tradeoff.
