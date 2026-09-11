# Agent image generation

Administrators configure image models under **Admin → Image models**, using the
same encrypted provider connections as chat and speech. Apply migration
`0071_image_generation.sql` with `npm run db:migrate` before starting the server.

## Configure providers

1. Create an enabled provider connection with an API key and request timeout.
   For Azure, use the Foundry resource root, such as
   `https://YOUR-RESOURCE.services.ai.azure.com`, or that URL plus `/mai/v1`.
   For Meta, use `https://api.meta.ai/v1`.
   For OpenAI, use `https://api.openai.com/v1` and an OpenAI API key with access
   to GPT Image models. An existing OpenAI chat or speech connection can be reused.
2. Add an image model. Choose **Azure MAI**, **Meta Muse**, or **OpenAI Images**
   to populate a disabled preset. Set a stable local ID, display name, provider,
   and sort order.
3. For MAI-Image-2.6-Flash, enter your deployed model's **deployment name**.
   For Muse, use the upstream model ID `muse-image-1.0`.
   OpenAI defaults to `gpt-image-2.5-flare`; the upstream model ID is editable,
   for example to use `gpt-image-2.5-sunburst`. This adapter targets GPT Image
   models that support generation and editing, not legacy DALL-E models.
4. Optionally enable **Bill users for images** and set a USD price per image.
   This is the Pulpo user charge; it is not automatically synchronized with the
   provider's pricing. Billing is disabled by default.
5. Enable the model when its provider deployment is ready. Test a generation
   and an edit with an opted-in account before announcing availability.

Image generation honors the provider connection's timeout. There are no automatic
upstream retries. A connection referenced by an image model cannot be deleted;
remove or reassign those models first.

The Azure adapter follows the [Foundry MAI image API](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-mai-image):
JSON generations at `/mai/v1/images/generations`, multipart edits at
`/mai/v1/images/edits`, API-key authentication, and PNG output. Text generations
use 1024 × 1024 output. Edits accept one JPEG or PNG reference.

The Meta adapter follows the [Muse Image Responses cookbook](https://github.com/meta-models/meta-model-cookbook/tree/main/05_muse_image/01_image_api_fundamentals).
It sends `/v1/responses` requests with `store: false`, extracts
`image_generation_call.result`, and retains the image item ID and saved image
bytes locally for follow-up edits. It does not depend on a provider-held
conversation. Pulpo accepts up to four PNG, JPEG, or WebP references for Muse.
Generation and reasoning options remain at provider defaults.

The OpenAI adapter follows the [OpenAI Image API](https://developers.openai.com/api/docs/guides/image-generation):
JSON generations at `/v1/images/generations`, multipart edits at
`/v1/images/edits`, and bearer authentication. Pulpo requests one 1024 × 1024 PNG
with quality left at the provider default. Edits upload up to four PNG, JPEG,
or WebP references using `image[]`, including saved attachments from earlier
turns. No Responses API conversation or additional text model is required.
Returned token usage is saved as operation metadata; user billing remains the
configured flat charge per saved image, independent of upstream token costs.

All three adapters share the agent tool, encrypted provider connections,
timeouts, image validation, attachment storage, and billing/recovery flow.
Provider capabilities determine input formats, reference limits, and whether
prior image items can be replayed. The tool advertises the selected provider's
reference limits. Adding OpenAI requires no database migration or changes to
existing Azure and Meta entries; admins must explicitly add and enable it.

## User settings and tool inputs

On web and desktop, open **Settings → Agent → Image generation**. On mobile,
open **Settings → Agent → Image generation**. Choose a model and enable image
generation; the setting and selected model sync with the account. New and existing
accounts default to `{ "enabled": false, "modelId": null }`. An unavailable
selection is retained, and another provider is never selected automatically.

Agent mode must also be enabled. Only opted-in accounts with an available selected
model receive the `generate_image` tool definition. Execution checks the setting
again, including after budget reservation. The tool accepts:

```json
{
  "prompt": "Make this landscape look like a watercolor painting",
  "referenceImages": [{ "attachmentId": "THE-CHAT-ATTACHMENT-UUID" }],
  "filename": "watercolor.png"
}
```

References may instead use `{ "path": "/workspace/reference.png" }`. Attachments
must belong to the account and current chat. Workspace references use the existing
authorized workspace manager. Pulpo validates decoded image content, rejects
animation, and limits images to 20 MiB and 40 megapixels; prompts are limited to
32,000 UTF-8 bytes. There is no tool field for choosing a model or supplying
thinking text.

Each saved image appears as an ordinary conversation attachment, has an agent
preview, and is available to workspace tools. An attachment reference can be used
for a follow-up edit without starting a workspace. Generated files count toward
the user's attachment quota.

## Accounting, recovery, and backups

Pulpo reserves the configured charge before contacting the provider and records
one charge for a successfully saved image. Agent settlement includes that charge
even after cancellation. Durable operation claims prevent duplicate calls and
charges on replay; saved results are reused. Resume and settlement reconcile
images saved immediately before an interrupted billing write, even if the account
has since disabled generation.

An interrupted request with no saved result is not automatically repeated because
its upstream outcome may be unknown. The user may explicitly request another
generation. Provider refusals, input failures, unavailable models, and insufficient
balance or storage return actionable errors without provider credentials or raw
image data in diagnostic messages.

Full backups include the image catalog, operation metadata, and generated
attachments. Legacy backups without the new tables remain supported. Restore
uses the normal provider-secret and attachment-blob handling. Temporary-chat
operation metadata follows the existing backup exclusion policy.

## APIs

`GET /api/image-models` requires authentication and exposes available entries
without provider connection IDs, credentials, or upstream model IDs.
Admin CRUD uses `GET`/`POST /api/admin/image-models` and
`PATCH`/`DELETE /api/admin/image-models/:id`.
The corresponding management prefix is `/api/management/v1/image-models`;
reads require `catalog:read`, mutations require `catalog:write`, and all require
a current administrator. Management account settings accept `imageGeneration`.
