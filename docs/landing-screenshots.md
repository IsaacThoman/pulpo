# Landing page screenshots

The web landing page shown to signed-out visitors at `/` uses a screenshot of the chat view in light and dark variants: `apps/web/public/landing/chat-light.webp` and `chat-dark.webp`. `apps/web/scripts/capture-landing-screenshots.mjs` regenerates both from a Pulpo instance you sign in to. Only capture accounts whose chats and profile can appear publicly.

## Requirements

- The Playwright Chromium browser: `npx playwright install chromium`.
- `cwebp` for the WebP conversion: `brew install webp`.
- An account whose data can appear publicly: either the local preview admin, or a dedicated demo account on production.

## Capture from production

Production has the full model catalog, so the screenshot matches what visitors get.

1. Sign up a dedicated demo account on [pulpo.baby](https://pulpo.baby) and give it a presentable name, username, and enough balance for eight short prompts. Keep the account empty so the script fills the sidebar with demo chats. Never capture a personal account: its chat titles appear in the sidebar.
2. Run the script against production:

   ```sh
   PULPO_URL=https://pulpo.baby npm run capture:landing -w @pulpo/web
   ```

3. Sign in with the demo account in the Chromium window that opens. The script waits up to 10 minutes, then continues on its own.
4. Review the new images, then commit them.

The demo chats are real requests: they're billed to the demo account and appear in its usage like any other chats.

## Capture from the local preview

This needs no production account, but the local preview only has the preview provider's models.

1. Configure the local preview (`npm run local:preview:init`, then fill in `~/.config/pulpo/local-preview.env`).
2. For a clean sidebar, start from an empty stack with `npm run local:preview:reset`. Otherwise, run `npm run local:preview:refresh`. Either way the stack serves `http://localhost:8080`.
3. Run the script with a demo profile, since the preview admin is named "Preview Admin":

   ```sh
   npm run capture:landing -w @pulpo/web -- --demo-profile
   ```

4. Sign in as the preview admin (`PULPO_PREVIEW_ADMIN_EMAIL` and `PULPO_PREVIEW_ADMIN_PASSWORD` in the local preview config) in the Chromium window.
5. Review the new images, then commit them.

## What the script does

- With `--demo-profile`, renames the signed-in account to **Alex Rivera** (`@alex`). This changes the real account, so use it only on disposable accounts.
- If the account has no chats, sends seven short prompts so the sidebar looks lived in.
- Sends the hero prompt: "Explain how KV caching speeds up transformer decoding. Include a short PyTorch snippet and the memory cost formula." Its answer shows headings, display math, and a code block, and a fresh chat shows the "now" timestamp.
- Opens that chat at 1440×900 with a device scale factor of 2, switches the composer's agent control to Pulpo Agent, scrolls to the start of the conversation, and captures it once with a light and once with a dark color scheme.
- Converts each capture with `cwebp -q 80 -m 6 -resize 2400 0` into `apps/web/public/landing/`.

## Options

- `PULPO_URL` sets the instance (default `http://localhost:8080`).
- `--demo-profile` renames the signed-in account to the demo identity before capturing.
- `--hero <chatId>` recaptures an existing chat without sending new prompts. Its timestamp shows the chat's real age.
