# Multilingual acceptance benchmark

Frozen before inspecting implementation or shared audit findings, 2026-10-15.

## Independent cases and acceptance criteria

This benchmark measures usable language modes rather than translation. All cases
must run locally without sending typed content to a service. English is the
compatibility baseline; Spanish and bilingual modes are explicit user choices.

1. **Mode persistence:** English, Español, and English + Español can be selected
   in settings; the extension reads the same persistent selection. Missing or
   invalid persisted values fall back to English. A mode change updates active
   dictionaries and the visible language indicator without reinstalling.
2. **English compatibility:** `hello`, `world`, `keyboard`, `thanks`, `tomorrow`
   remain recognized; `teh` → `the` and `hellp` → `hello` are correction candidates.
   Prefix `hel` offers `hello`. Existing English tests continue to pass.
3. **Spanish vocabulary breadth:** `hola`, `gracias`, `mañana`, `niño`, `corazón`,
   `familia`, `trabajo`, `comida`, `quiero`, `estamos` are recognized. A licensed,
   pinned, reproducible Spanish dictionary contains at least 10,000 entries;
   document source, license, transformations, and an integrity check.
4. **Spanish correction/completion:** `hols` offers `hola`, `graciss` offers
   `gracias`, `corazon` offers `corazón`, and prefix `maña` offers `mañana`.
   Preserve correctly spelled accented words and distinguish `ano` from `año`;
   accent-insensitive matching must not erase correct literal words.
5. **Bilingual switching within a sentence:** `hello familia`, `gracias friend`,
   and `mañana meeting` retain both languages' valid words. Prefix suggestions
   can find `hello` and `hola` without toggling modes. No claim of grammatical
   code-switching inference is required.
6. **Swipe:** where a swipe decoder exists, representative paths for `hello`,
   `hola`, `gracias`, and `mañana` yield the target in the first five candidates
   in the relevant mode. Accented letters use their base-key geometry while
   retaining the dictionary spelling. Measure unsupported paths explicitly.
7. **Prediction:** Spanish and bilingual modes offer Spanish next-word choices
   (e.g. after `muchas`, `gracias` appears); English predictions remain available
   in bilingual mode. Report any missing contextual model honestly.
8. **Language UX:** a user can discover/change the language in both host settings
   and keyboard context. Spanish letters/diacritics are enterable; settings copy
   describes scope accurately and does not imply translation or cloud processing.
9. **Personal learning/privacy:** language changes never delete learned words;
   disabling learning still prevents writes, secure-field protections remain,
   and no dictionary update or language choice creates a content network path.
10. **Operational quality:** deterministic meaningful tests cover language
    selection, normalization, correction/completion, bilingual vocabulary and
    resource integrity. Run applicable existing checks and a build if available.

Before/after results, implementation decisions, commands and limitations will
be appended below without changing these frozen cases or criteria.
