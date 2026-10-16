# Spanish / English entry UX: frozen blind protocol

Frozen before source, tests, AGENTS.md, or earlier audits were read. Parent: `7f92656086fc27914aeb7c5de9928eb38fefda6d`. Scope: character entry and language switching in `en_US`, `es`, and `en_es`; no ranking, dictionaries, dictation, or language-stack caching changes.

## External behavioral oracle

A writer must be able to enter ordinary Spanish and English text without losing, silently replacing, or incorrectly casing deliberate characters. Spanish-capable modes must offer a discoverable route to ñ, accented vowels, ü, ¿ and ¡. Shift and caps lock apply consistently to letters and their alternatives. Punctuation must preserve deliberate surrounding text. Switching language mid-composition must preserve already committed text and permit subsequent character entry; the visible language/mode indication must match the active mode. Switching alone must not commit an unrelated suggestion. These are user requirements, not claims about the present implementation or a mandate to add a particular gesture.

## Development tasks (may guide implementation)

1. In Spanish-capable modes, enter `¿Dónde está el niño? ¡Sí!` using available character controls. Check exact characters, casing, and punctuation.
2. Enter `año`, `pingüino`, `ÁÉÍÓÚ`, and `Ñ` with shift; repeat with caps lock. Check that deliberate alternatives survive insertion.
3. Start `Hello ` in English, switch to Spanish and enter `señor`, then switch back and enter ` today.` Check text preservation and active-mode feedback.
4. Explore punctuation and accent controls for reachability and clear labels. Prefer one coherent, low-risk affordance fix; retain nothing if regression cost exceeds benefit.

## Held-out acceptance (sealed until candidate implementation is complete)

Do not use the following cases to tune the candidate. At acceptance, record exact inputs, expected output, actual result, and execution layer; distinguish executable core checks from unexecuted native interactions.

H1. In each Spanish-capable mode, enter `¡Qué vergüenza! ¿MAÑANA?` with lowercase, shifted, and locked alternatives as needed. Expected exact output, including inverted punctuation, Ü/ü, and Ñ/ñ as deliberately chosen.
H2. Enter `¿` and `¡` into existing text `uno dos` at the cursor between words; move the cursor and enter `?`/`!`. Expected only requested insertions, no vanished text or unsolicited spaces.
H3. Type `My año is 2026`, changing English → bilingual → Spanish → English between words. Expected existing text unchanged at every switch; future character entry and displayed mode agree.
H4. Exercise the same changed control with English-only text `WHY? Wow!` and with shift/caps lock toggles. Expected unchanged English character behavior and no stuck alternative palette or shift state.

## Decision / reporting

Run the relevant baseline before changing production code. Add tests through the production path for any changed behavior; execute held-out checks only after freezing the implementation. Record baseline failures, candidate results, limitations, commands, elapsed cost, exact commits, and retained/rejected changes in `spanish-entry-ux-sweep.md`. No push, physical deployment, occupied simulators, or edits outside this checkout.
