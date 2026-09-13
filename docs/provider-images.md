# Provider image encoding

In **Admin → Providers**, edit a provider and enable **Convert images to WebP**
when that provider's vision models accept WebP. **WebP quality** accepts an integer
from 1 to 100 and defaults to 80. Conversion is off by default for existing and
new providers.

The same settings are available through provider create/update in the management
API and CLI: `convertImagesToWebp` (boolean) and `webpQuality` (integer).

Conversion applies to uploaded images, inline image data URLs, and agent image
content (including `view_image` and generated image tool results). It preserves
pixel dimensions, applies EXIF orientation, and preserves transparency and
animation. Stored originals and canonical agent history remain intact. Outgoing
requests carry the converted bytes and `image/webp` MIME type. Remote image URLs
and provider file IDs remain unchanged; Pulpo does not fetch remote URLs for this
setting. Unsupported or undecodable images retain their existing pass-through
behavior.

Each request uses its destination provider's settings, including fallback model
requests. OCR uses the OCR model's provider settings independently of the main
model. Rendition caches distinguish encoding and quality; OCR cache entries use
the bytes actually sent.

Lossy WebP can reduce upload bytes substantially, but may soften fine text and
other details. It does not resize images or reduce how many images remain in
context, so it does not by itself resolve provider limits on image tokens or
processed image embeddings.
