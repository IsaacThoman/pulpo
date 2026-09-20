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
   Enable **Automatic aspect ratio supported** for MAI-Image-2.6 and
   MAI-Image-2.6-Flash; leave it disabled for older MAI deployments. The 2.6
   preset enables this capability. Existing records recognize the canonical
   2.6 model ID or display name; custom deployment and display names require
   explicitly enabling the checkbox. No database migration is required.
   For Muse, use the upstream model ID `muse-image-1.0`.
   OpenAI defaults to `gpt-image-2.5-flare`; the upstream model ID is editable,
   for example to use `gpt-image-2.5-sunburst`. This adapter targets GPT Image
   models that support generation and editing, not legacy DALL-E models.
4. Optionally enable **Bill users for images** and choose **Per image** or
   **Per token**. These are Pulpo user prices, manually managed and independent
   of provider price changes. Billing is disabled by default.
   - Per image charges the configured USD amount per successfully saved image.
   - OpenAI token pricing separates text input, cached text input, image input,
     cached image input, text output, and image output. Rates are USD per million
     tokens. The Flare preset includes published rates verified September 13,
     2026; review them when changing the upstream model.
   - Meta token pricing uses combined input, cached input, and output rates.
     Enter each rate explicitly; zero is allowed. Output includes reasoning and
     is billed once, not again as a separate reasoning charge.
   - Azure MAI supports per-image pricing only because its documented API
     response does not report token usage.
   - Token billing requires a positive **Upfront reservation (USD)**. This is a
     budget hold, not a fixed fee or maximum price. If actual usage exceeds the
     hold, Pulpo reserves the difference before saving the image. If funds are
     insufficient, the image is not saved or charged; the provider may still
     charge Pulpo for that generation.
5. Enable the model when its provider deployment is ready. Test a generation
   and an edit with an opted-in account before announcing availability.

Image generation honors the provider connection's timeout. There are no automatic
upstream retries. A connection referenced by an image model cannot be deleted;
remove or reassign those models first.

The Azure adapter follows the [Foundry MAI image API](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-mai-image):
JSON generations at `/mai/v1/images/generations`, multipart edits at
`/mai/v1/images/edits`, API-key authentication, and PNG output. With automatic
aspect-ratio support enabled, both generation and editing send
`auto_aspect_ratio: true` so the model chooses framing from the prompt and
references. Older deployments retain their provider defaults. Explicit square,
landscape, and portrait requests use 1024 × 1024, 1200 × 800, and 800 × 1200
for text generations, within MAI's dimension and pixel limits. Edits accept
one JPEG or PNG reference; explicit proportions are requested in the prompt
because MAI does not document width/height parameters for edits.

The Meta adapter follows the [Muse Image Responses cookbook](https://github.com/meta-models/meta-model-cookbook/tree/main/05_muse_image/01_image_api_fundamentals).
It sends `/v1/responses` requests with `store: false`, extracts
`image_generation_call.result`, and retains the image item ID and saved image
bytes locally for follow-up edits. Legacy generated attachments can replay their
image item; workspace files are sent as fresh image references. It does not depend on a provider-held
conversation. Pulpo accepts up to four PNG, JPEG, or WebP references for Muse.
Generation and reasoning options remain at provider defaults.

The OpenAI adapter follows the [OpenAI Image API](https://developers.openai.com/api/docs/guides/image-generation):
JSON generations at `/v1/images/generations`, multipart edits at
`/v1/images/edits`, and bearer authentication. Pulpo requests one PNG with
`size: "auto"` and quality left at the provider default. Explicit square,
landscape, and portrait requests use 1024 × 1024, 1536 × 1024, and 1024 × 1536
for both generation and editing. Edits upload up to four PNG, JPEG,
or WebP references using `image[]`, including saved attachments from earlier
turns. No Responses API conversation or additional text model is required.
Returned usage breakdowns are saved as operation metadata. Token billing sums
all applicable categories with integer arithmetic, then rounds upward once to
one microdollar. Per-image billing continues to ignore token usage.

Only explicitly reported cached tokens receive cached rates. If cached usage is
omitted, ordinary input rates apply. OpenAI cached tokens must be attributable
to text or image input; a positive aggregate cache count is sufficient only when
all input belongs to one modality. Missing, malformed, inconsistent, or
ambiguous required token usage fails without saving or billing an image. Pulpo
does not estimate missing usage or fall back to a flat fee. The reported user
charge therefore depends on the usage breakdown available from the provider.

All three adapters share the agent tool, encrypted provider connections,
timeouts, image validation, workspace storage, and billing/recovery flow.
Provider capabilities determine input formats, reference limits, and whether
prior image items can be replayed. The tool advertises the selected provider's
reference limits. Adding OpenAI requires no database migration or changes to
existing Azure and Meta entries; admins must explicitly add and enable it.

## User settings and tool inputs

On web and desktop, open **Settings → Agent → Image generation**. On mobile,
open **Settings → Personalization → Image generation**. Choose a model and enable image
generation; the setting and selected model sync with the account. New and existing
accounts default to `{ "enabled": false, "modelId": null }`. Admins can set or clear a
**Default image model** in **Admin → Image models**, just like speech defaults.
When no personal model is selected, web, mobile, and the server use this default.
Users must still enable image generation. Personal choices take precedence, and
users following the default pick up later admin changes. An unavailable
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

References may instead use `{ "path": "/workspace/reference.png" }`. For workspace
files, the shorthand `"referenceImages": ["/workspace/reference.png"]` is also
accepted and normalized to the same path object before execution. Attachment IDs
must use the explicit `attachmentId` object; bare IDs, URLs, and paths outside
`/workspace/` are not accepted as shorthand. Reference counts and existing file
access checks apply to both forms. Attachments
must belong to the account and current chat. Workspace references use the existing
authorized workspace manager. Pulpo validates decoded image content, rejects
animation, and limits images to 20 MiB and 40 megapixels; prompts are limited to
32,000 UTF-8 bytes. There is no tool field for choosing a model or supplying
thinking text.

The optional `aspectRatio` argument accepts `auto` (the default), `1:1` (square),
`3:2` (landscape), and `2:3` (portrait). With `auto`, describe the intended
composition or another aspect ratio in the prompt. For edits, ask to preserve
the reference image's proportions unless the user requests reframing.
OpenAI and MAI text generations use explicit sizes for the three fixed ratios.
Muse and MAI edits receive a prompt instruction instead, so exact proportions
are model-dependent. Automatic sizing can still produce squares when suitable;
it removes Pulpo's forced square request. Existing images are not modified.

Before an edit is sent upstream, Pulpo re-encodes each reference as a standard
single image in its validated JPEG, PNG, or WebP format. This applies EXIF
orientation, converts colors to sRGB, and removes metadata and auxiliary images
such as the HDR gain map in phone JPEG/MPO files. PNG and WebP retain transparency;
JPEG is encoded at quality 95 and WebP losslessly. Dimensions are preserved after
orientation, and the encoded result must also fit the 20 MiB limit. Original
attachments and workspace files are unchanged. Both attachment IDs and workspace
paths use this same normalization before any provider call.

`generate_image` saves the result only as a file under `/workspace/`. Its text-only
output reports the path, name, MIME type, and size, and explicitly tells the model
it **MUST call `attach_file` with that path if it wants the user to see or download
the image**. Generation does not create a chat attachment or preview. The model
can use `view_image` to inspect the file or its workspace path for another edit.

An available workspace is required before contacting the image provider. Generated
files follow the normal workspace lifetime and disappear when it expires unless
explicitly attached. `attach_file` publishes a normal conversation attachment and
applies the user's attachment quota; a full attachment quota does not prevent
workspace-only generation. Attached images remain available for later edits after
the original workspace expires.

## Accounting, recovery, and backups

Pulpo reserves the configured per-image charge or token budget hold before
contacting the provider and records one charge for a successfully saved image.
Token billing settles actual usage and releases unused funds with the agent
response. Rates and usage are snapshotted per operation, so later catalog edits
do not change saved or recovered charges. Agent settlement includes that charge
even after cancellation. Durable operation claims prevent duplicate calls and
charges on replay; saved results are reused. Resume and settlement reconcile
images saved immediately before an interrupted billing write, even if the account
has since disabled generation. Before writing the bytes, Pulpo stores their path,
size, SHA-256 checksum, and original workspace lease in the operation metadata.
Recovery checks that exact file in that authorized lease without provisioning a
new workspace. Missing or changed files never trigger another paid generation.
A lost save acknowledgement can therefore be reconciled if the exact bytes exist.
Legacy operations that saved attachments remain recoverable.

An interrupted request with no saved result is not automatically repeated because
its upstream outcome may be unknown. The user may explicitly request another
generation. Provider refusals, input failures, unavailable models, and insufficient
balance or workspace storage return actionable errors without provider credentials or raw
image data in diagnostic messages.

Recognized provider errors distinguish unsupported image formats, oversized
images, and explicit content-policy rejections. Unrecognized errors report the
HTTP status and an unconfirmed cause; they do not imply a policy restriction.
Error bodies are read with a byte/time limit and mapped to fixed messages rather
than passed to the chat model verbatim. The tool instructs the model not to retry
the same image repeatedly by rewording its prompt.

Full backups include the image catalog, operation metadata, and explicitly attached
images. Unattached generated files live only in the disposable workspace and are
not attachment blobs in a backup. Legacy backups without the image tables remain supported. Legacy model configs
and operation snapshots without billing fields default to per-image pricing;
no database migration is required for token pricing. Restore
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
