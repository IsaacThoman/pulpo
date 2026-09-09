# Image generation validation

Validated locally on September 9, 2026. Configuration and operator instructions
are in [Agent image generation](../image-generation.md).

## Automated checks

- `npm run build`: passed, including web/server builds and mobile/desktop typechecks.
- `npm run lint`: passed without warnings.
- `npm run docs:build`: passed.
- Full contracts, web, server, and mobile suites passed. Web tests on the local
  Node 26 runtime required `NODE_OPTIONS=--no-experimental-webstorage` because its
  built-in `localStorage` conflicts with the test environment. An avatar test
  timed out during simultaneous builds; the complete server suite passed with
  `--maxWorkers=4`. No test expectations or timeouts were weakened.
- Focused adapter/tool tests cover Azure JSON generation and multipart edits,
  Meta stateless image-item replay, image format validation, malformed/refused
  responses, credential-safe failures, and cancellation before and during HTTP
  requests (including response-body reads).
- The opt-in PostgreSQL suite passed against a disposable migrated database.
  It verifies catalog authorization, provider deletion protection, settings
  rechecks, chat ownership, workspace references, saved attachments, replay and
  concurrent claims, interrupted result recovery, balance/storage failures, and
  durable image charges after cancellation. Upstream HTTP and blob storage are
  fixtures; database constraints and transactions are real.
- Preference tests cover defaults, unavailable selections, web persistence,
  mobile mapping and the native production update action. Preview tests cover
  both WebP tool previews and PNG generated attachments. Backup tests cover
  legacy optional tables and temporary-chat metadata exclusion; a full encrypted
  backup/restore smoke test was not performed.

Run the database suite only against the dedicated disposable database:

```sh
NODE_ENV=test \
DATABASE_URL=postgres://postgres:pulpo@localhost:5499/pulpo_image_test \
PULPO_IMAGE_POSTGRES_TEST=1 \
npm run test -w @pulpo/server -- src/image-generation
```

## Visual checks

Used temporary harnesses rendering the actual application components with a
fixture catalog and thumbnail. Web checks covered desktop light mode, narrow
390-pixel dark mode, the admin model dialog, settings, and image-result previews.
No horizontal overflow was observed.

On the iPhone 17 Pro / iOS 26.5 simulator, a separately installed QA app rendered
the actual native image settings and image preview components. Model selection
changed from Muse to MAI and updated the displayed price; opt-out changed the
switch state. Labels and previews rendered correctly. Android control branches
were covered by component tests, without an Android emulator visual run.

These were component-level visual checks, not an authenticated end-to-end chat
session. Temporary harnesses and the simulator QA app were removed. Raw screen
captures and logs are excluded from the commit.

## Remaining external coverage

No live Azure or Meta calls were made: test credentials were not supplied or
present in the environment. Before enabling a deployment, run one text generation
and one follow-up attachment edit for each provider, then verify the saved image
and configured user charge. There was no deployment or merge as part of this work.
