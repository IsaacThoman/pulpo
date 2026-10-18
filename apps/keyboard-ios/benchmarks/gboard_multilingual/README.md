# Multilingual Gboard / Pulpo comparison

Read PROTOCOL.md and cases.json first. They were frozen in `30025e39` before
implementation inspection. Replays of these now-revealed inputs are regression
checks, not fresh blind benchmarks. No production code is changed here.

Use only the assigned Android emulator. These scripts pin `emulator-5554`.
Artifacts, geometry, screenshots, generated Swift packages and APKs belong in an
external directory. Never clear Gboard data. The test APK uses its own package,
`com.pulpo.multilingualaudit`; `install -r` preserves its data and signing key.

## Reproduction

1. Pin the desired PR revision in a separate detached checkout. Run
   `python3 run_engine.py --source CHECKOUT --out ARTIFACTS`. This creates a
   temporary SwiftPM executable, loads that checkout's real dictionaries, and
   calls its actual public KeyboardEngine APIs. It needs Swift 6.2 or later.
2. Create `ARTIFACTS/geometry.json` containing `{}` and run
   `bash build_android.sh ARTIFACTS`. Defaults are the installed Android SDK,
   Android Studio Java, API 36 compile tools, and the API 37 runtime. Override
   ANDROID_SDK_ROOT/JAVA_HOME if necessary. No physical installation occurs.
3. In Gboard Settings > Languages add English (US) QWERTY and Español (EE.UU.)
   QWERTY (Ñ). Open each layout and turn Multilingual typing OFF for the separate
   `en` and `es` passes. For `en-es`, enable Multilingual typing on the English
   layout with Spanish checked. Keep captures of each actual switch state.
   In Corrections & suggestions keep Auto-correction ON, Auto-capitalization OFF.
   Disable double-space period / smart punctuation if the installed version
   exposes them; record missing controls and mismatches. Our field does not ask
   for capitalization; it requests multiline autocorrection and no personalized
   learning. This is not a private/password field.
4. Select the active layout with `android.py --out ARTIFACTS probe NAME --select-language 'Español (EE.UU.)'` (use English (US) for English/bilingual). This long-presses the hierarchy-labeled Space key and chooses
   its label in Change keyboard. Capture both settings and active keyboard.
   Never assume installed languages prove the currently active mode.
5. Use `python3 android.py --out ARTIFACTS probe letters-en` (and equivalent mode
   names). Probe symbol geometry with `probe symbols-en --key 'Symbol keyboard'` (Spanish label: `Teclado de símbolos`).
   Probe accents with `probe accent-en-e --key e --hold`. Probes store hierarchy
   JSON and screenshots; inspect both before using their coordinates. Repeat
   per mode, including bilingual. English requires é and ñ; Spanish direct-entry
   requires é and ó, with ñ already on its layout; bilingual requires é and ñ.
6. Derive geometry, for example:
   `python3 android.py --out ARTIFACTS geometry --mode en --active English --letters letters-en --symbols symbols-en --accent é:e:accent-en-e --accent ñ:n:accent-en-n`.
   Spanish uses `--active Español`; bilingual uses the actual observed label,
   not a guessed name. Add the corresponding accent probes. Rebuild the APK
   after every geometry update, then run
   `python3 android.py --out ARTIFACTS run --mode en`. Repeat es and en-es in
   frozen order. No corpus changes or scored exploratory passes are needed.
7. `python3 summarize.py ARTIFACTS` validates complete/unique IDs and exact score
   consistency, then prints every row plus mode/category/availability counts.

Probe and scored output filenames refuse overwrite. A failed instrumentation
completion cannot be mistaken for stale success. Infrastructure retries require
new output directories and retention of prior attempts. A mode emits all twelve
rows, with unsupported entry explicitly unavailable. The runner validates the
active language label and all 26 letter positions before every observable case.
Gboard receives actual injected touchscreen events, never adb text, clipboard,
or suggestion acceptance. Digits use the verified symbol page; accents use
verified long-press menus. Pulpo receives character and space calls without tap
coordinates. The different touch models and sequential timing prevent motor
accuracy or latency conclusions.

`android.py run` captures the app's files in a tar archive, including every
pre/post hierarchy and final screenshot. Keep raw results outside Git; paste
all observed failures and unavailable cases into the audit. APK signing keys
and learned Gboard state mean cross-machine bit-for-bit reproducibility is not
claimed. The runner requests no learning, but cannot inspect Gboard's private
model/history. Unsupported character success through Pulpo's core API does not
prove that character is reachable from Pulpo's on-screen layout.
