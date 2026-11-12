# Landing page demo and screenshots

The web landing page shown to signed-out visitors at `/` opens with an animated demo, and uses screenshots further down. Link previews use `apps/web/public/og-image.jpg`.

## Hero demo

The demo at the top of the page is drawn in code, not recorded: a browser window and an iPhone, both showing Pulpo signed in to one account. It plays a few scenes in turn, and the tabs above it jump between them:

- **Perfect sync** (`sync`): a message is typed in the browser and appears on the phone, the phone finishes and sends it, and the agent searches the web and answers on both.
- **Any model** (`models`): the browser picks another model from its model list, the phone follows, and that model answers a question typed in the browser.
- **Instant workspaces** (`agent`): an agent starts a workspace, runs code, and attaches the chart it made.

The components are in `apps/web/src/pages/landing/demo/`. They follow the page's light or dark theme and scale with the layout. The workspaces section further down shows the agent scene as a still.

Everything the demo shows comes from `apps/web/src/pages/landing/demo/script.json`:

- `scenes` is the list of scenes. You write a scene's `id`, the `model` it opens on, and its `beats`: what a person does, in order, ending with a `send`.
  - `{ "type": "type", "on": "web" | "phone", "text": "…" }` types into the composer. The phone taps its keyboard, so its text must be lowercase letters and spaces. `keyMs` overrides the pace for a long message.
  - `{ "type": "pick", "on": "web" | "phone", "model": "<id>" }` chooses another model, from the browser's model list or the phone's menu.
  - `{ "type": "send", "on": "web" | "phone" }` sends the message.
- A scene's `title` and `response` come from a real instance. `response.deltas` holds each streamed chunk of the answer with its time in milliseconds after sending, `response.steps` holds what an agent did in its workspace, and `response.attachment` points at an image it attached, saved under `apps/web/public/landing/`. A scene's `speed` plays its response that many times faster than it really arrived, which keeps an agent run watchable; the label still says how long the agent really worked. `answerSpeed` sets the pace of the answer's text separately once it starts, so a value below 1 slows the stream enough to watch it arrive on both screens while the steps before it stay fast. `thinkMs` replaces the real wait before the answer's first text, and `streamMs` streams the answer evenly over that many milliseconds instead of with its real chunk timing, which can arrive in one burst; use `streamMs` or `answerSpeed`, not both. `scroll: "top"` keeps the start of the conversation in view while the answer arrives instead of following its newest line.
- `models`, `labs`, `user`, and `sidebar` also come from the instance. `models` is the account's favorites, which is what both model lists show, and `labs` is the marks down the side of the browser's.
- `suggestions` are the cards on the new-chat screen.
- `pacing` sets the typing speeds, the delay before a draft or model choice shows on the other device, how long the model list stays open (`pickMs`) and keeps the chosen model highlighted (`pickedMs`), the pauses, and how long a finished answer stays before the next scene.

Edit the file by hand to change beats, speeds, or pacing. Then run the capture script, which signs in, plays each scene's message against the instance with the scene's model, records the stream from the socket, saves any attached image, deletes the chats it made, and rewrites the captured fields:

```sh
PULPO_DEMO_EMAIL=… PULPO_DEMO_PASSWORD=… npm run capture:landing-demo -w @pulpo/web
npm run capture:landing-demo -w @pulpo/web -- --only agent
```

It targets production by default (`PULPO_URL` changes that) and uses the account's composer controls and favorites, so set those in the app first. It leaves the account on the model it started with. Without the two variables it opens a browser window and waits for you to sign in. Use the demo account: its name and chat titles appear in the demo. Stream timing varies a lot between runs, so rerun a scene with `--only` if its answer took unusually long to start. Each scene is a real, billed request.

`timeline.ts` turns the script into the picture at any moment of the loop and is covered by `timeline.test.ts`. `MarkdownLite.tsx` renders only paragraphs, lists, bold, italics, and links, so pick prompts whose answers stay within those and fit the phone screen. To add a scene, add it to `scenes`, give it a tab label and icon in `HeroDemo.tsx`, and capture it.

## App screenshots

The apps section shows real screenshots of the mobile app, each in a phone frame drawn by `apps/web/src/pages/landing/DeviceFrame.tsx`. The list of shots is `APP_SHOTS` in `apps/web/src/pages/landing/sections.tsx`. Every shot has a light and a dark version in `apps/web/public/landing/`, and the page shows the one that matches its theme:

| Shot | Device | What it shows |
| --- | --- | --- |
| `app-ios-models-{light,dark}.webp` | iPhone 18 Pro simulator | A new chat with the model menu open and the keyboard down |
| `app-android-brunch-{light,dark}.webp` | Android emulator with the Pixel 8 display overlay | The answer to "Find nice brunch places in Marietta this weekend", scrolled to the top, with "Worked for…" folded |
| `app-ios-drawer-{light,dark}.webp` | iPhone 18 Pro simulator | The chats drawer open, with fourteen demo chats filling the list and the brunch chat selected, its answer peeking out beside the drawer |

To retake them:

1. Build Release apps of the current mobile app.
   - iOS: install a Release simulator build on an iPhone 18 Pro simulator (1206×2622) on iOS 27.0. Use a copy of `apps/mobile/scripts/deploy-iphone.py` that reads the source checkout from an environment variable and launches with `xcrun simctl launch`, run with `PULPO_IOS_BUILD_ROOT=~/.cache/pulpo/simulator-build PULPO_IOS_DEVICE=<udid>`.
   - Android: run `expo prebuild --platform android` and `./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a` in the same build checkout with JDK 21, then `adb install` the APK on the `Medium_Phone_API_37.0` emulator (1080×2400). Start that emulator headless with `-gpu swiftshader_indirect`, because other GPU modes give blank screenshots. Without an upload keystore, the release build is signed with the debug key, which is fine for screenshots.
   - The Android emulator has square corners and no camera cutout by default, so its status bar hugs the corners. Turn on the emulator's Pixel 8 display overlays, which match its 1080×2400 screen (a centered camera hole and rounded corners), then reboot it:

     ```sh
     adb shell cmd overlay enable com.android.internal.emulation.pixel_8
     adb shell cmd overlay enable com.android.systemui.emulation.pixel_8
     adb reboot
     ```

     `adb shell dumpsys window | grep mDisplayCutout=` should then show a 132 px top inset. Disable both overlays again when you're done.
2. Sign in to `https://pulpo.baby` with the demo account (`PULPO_DEMO_EMAIL` and `PULPO_DEMO_PASSWORD`; see the hero demo). The Android build may start on another server, so use "Change server" on the login screen.
3. Turn off Settings → Interface → "Show response costs" for the account (it syncs to both phones).
4. Send the brunch prompt from the web app or a phone, with GPT-6 Luna selected and Pulpo Agent on. The chat syncs to both phones. GPT-6 Luna tends to give the weekend's dates, so set this custom instruction (Settings → Personalization) first, then clear it: `Never write specific calendar dates (like a month and day) in answers; say "this weekend", "Saturday" or "Sunday" instead.`

   Capture the chat soon after it finishes, so its label reads "just now" rather than "… ago".
5. For the drawer, add demo chats instead of sending prompts. The drawer shows the account's own chats, so cover them with chats that can appear publicly, and leave the account's chats and folders alone. With the demo account its header shows "Pulpo" and a smiley avatar rather than the account's name. Check it again if you use another account.
   - Import about fourteen chats, enough to fill the list, with `POST /api/chats/import` (`source: 'pulpo'`), each with one short prompt and reply, as in `apps/mobile/e2e/html-preview-seed.mjs`. This needs no model calls. The import keeps each chat's `createdAt` and `updatedAt`, and the drawer labels chats from the last 24 hours with a time and older ones with a date, so give the first few times today before 9:41 and the rest dates on earlier days.
   - Make the top chat "🥞 Marietta Brunch Spots" with the same answer as the Android shot, so the chat peeking out beside the drawer matches it. Before deleting the brunch chat from step 4, save it with `GET /api/chats/:id`, and import its response's `input`, `output` and `usage` unchanged, with `modelId: 'gpt-6-luna'`. Shift its `createdAt`, `completedAt` and each output item's `startedAt` by the same amount, so that it finishes at the chat's `updatedAt`. Imported responses have no request start time, so the folded row's "Worked for…" duration is the sum of the steps' `durationMs`, which leaves out the time between steps. Add the difference to the first step's `durationMs` so that the row shows the same duration as the Android shot.
   - Imported chats get sort order 0, below chats the account moved or created, so they land under its own chats. Pin them all, then unpin them in the order to show, top first (`POST /api/sidebar/pin` with `{ ids, pinned }`, twice). Unpinning puts each chat at the top of the list without changing its `updatedAt` or any other chat. Don't use `PATCH /api/chats/:id` with a `sortOrder`, since it also sets `updatedAt` to now.
   - On the phone, open the top chat and scroll it to the start of the conversation, then open the drawer with the menu button, so that chat shows as selected. The new chats sync without relaunching the app.
6. Clean the status bars:

   ```sh
   xcrun simctl status_bar <udid> override --time 9:41 --batteryState discharging --batteryLevel 100 --cellularMode active --cellularBars 4 --wifiBars 3 --dataNetwork wifi
   adb emu network speed lte
   adb shell settings put global sysui_demo_allowed 1
   adb shell am broadcast -a com.android.systemui.demo -e command enter
   adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941
   adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false -e powersave false
   adb shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false
   ```

   `--batteryState charged` shows a green charging bolt, so use `discharging`. Android demo mode shows Wi-Fi and hides the mobile signal. Don't send it a `network -e mobile show` command: on this image it labels the signal "3G" whatever `datatype` you pass.
7. Set up each screen, then capture it once per appearance. On iOS, the app focuses the composer on launch, so drag down on the chat to hide the keyboard before opening the model menu. Switching the appearance keeps the screen as it is:

   ```sh
   xcrun simctl ui <udid> appearance light   # or dark
   xcrun simctl io <udid> screenshot ios-models-light.png
   adb shell cmd uimode night no             # or yes
   adb exec-out screencap -p > android-brunch-light.png
   ```

   Take the light and dark versions of a chat one after the other, so the time label matches.
8. Convert each capture to a 600 px wide WebP at quality 80, for example with sharp: `sharp(png).resize({ width: 600 }).webp({ quality: 80, effort: 6 })`. Keep the raw captures out of the repository. If the size changes, update `width` and `height` in `APP_SHOTS`.
9. Delete the chats you made, then delete them from the trash as well (`DELETE /api/chats/:id`, then `DELETE /api/chats/:id/permanent`), including the imported drawer chats. Check that `GET /api/chats` lists the same number of chats as before and that `GET /api/trash` doesn't list them. Turn "Show response costs" back on and clear the custom instruction.

Neither `simctl io screenshot` nor `screencap` captures the hardware: the screenshots have no Dynamic Island, home indicator, camera hole, or rounded corners. `DeviceFrame` draws them at the devices' geometry:

- iPhone 18 Pro (402×874 pt): the screen is clipped to the simulator's framebuffer mask (`framebufferMask` in `/Library/Developer/CoreSimulator/Profiles/DeviceTypes/iPhone 18 Pro.simdevicetype/Contents/Resources/`, 62 pt continuous corners), converted to an SVG path with `pdftocairo -svg`. The Dynamic Island is 126×37 pt, 11 pt from the top. The home indicator is 139×5 pt, 8 pt from the bottom, and is dark on light screens and light on dark ones.
- Android (Pixel 8 overlay, 1080×2400 px): the corners are 104 px at the top and 102 px at the bottom. The camera hole is 72.5 px wide and centered 65.75 px from the top. `adb shell cmd overlay lookup android android:string/config_mainBuiltInDisplayCutout` and `android:dimen/rounded_corner_radius_top` print these values.

A different device model needs these values measured again.

## Link preview image

`apps/web/public/og-image.jpg` is the image link previews show, referenced by `og:image` in `apps/web/index.html`. It's composed from the landing page itself: the logo and the page's headline above the hero demo, in the light theme, at 1440×756.

1. Start the web dev server: `npm run dev -w @pulpo/web`.
2. Run the capture. It opens the page with reduced motion, so the demo holds the first scene finished:

   ```sh
   npm run capture:og-image -w @pulpo/web
   ```

   `LANDING_URL` sets the page to capture if the dev server isn't on `http://localhost:5173/`.
3. Review `og-image.jpg`, then commit it.

It needs the Playwright Chromium browser: `npx playwright install chromium`.

The provider marks in the model grid come from `apps/web/public/ai-icons`.
