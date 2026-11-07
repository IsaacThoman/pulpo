package expo.modules.pulpoattachmentpreview

import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/** The largest page the preview runs, as on iOS. */
internal const val MAX_WEB_PREVIEW_BYTES = 10L * 1024 * 1024

private class PreviewException(name: String, message: String, code: String) : CodedException(code, "$name: $message", null)

/**
 * Android's half of the attachment preview module: only the sandboxed page preview. Other files open
 * through the system's ACTION_VIEW chooser (see src/native/openFile.android.ts).
 */
class PulpoAttachmentPreviewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PulpoAttachmentPreview")

    AsyncFunction("previewWebDocument") { uri: String, title: String, contentSecurityPolicy: String ->
      // Untrusted pages must never run with a real origin, whatever the caller passes.
      if (!contentSecurityPolicy.startsWith("sandbox ") || contentSecurityPolicy.contains("allow-same-origin") || contentSecurityPolicy.contains("allow-top-navigation")) {
        throw PreviewException("AttachmentPreviewUnavailable", "The preview sandbox policy is invalid.", "ERR_ATTACHMENT_PREVIEW_UNAVAILABLE")
      }
      val activity = appContext.currentActivity
        ?: throw PreviewException("AttachmentPreviewUnavailable", "The preview could not be presented.", "ERR_ATTACHMENT_PREVIEW_UNAVAILABLE")
      val parsed = Uri.parse(uri)
      val file = parsed.path?.let { File(it) }
      if (parsed.scheme != "file" || file == null || !file.isFile) {
        throw PreviewException("AttachmentPreviewMissingFile", "The file is no longer available.", "ERR_ATTACHMENT_PREVIEW_MISSING_FILE")
      }
      // Only the app's own downloads and generated pages: never another app's or shared storage.
      val canonical = file.canonicalPath
      val roots = listOfNotNull(activity.cacheDir, activity.filesDir).map { it.canonicalPath + File.separator }
      if (roots.none { canonical.startsWith(it) }) {
        throw PreviewException("AttachmentPreviewMissingFile", "The file is no longer available.", "ERR_ATTACHMENT_PREVIEW_MISSING_FILE")
      }
      if (file.length() > MAX_WEB_PREVIEW_BYTES) {
        throw PreviewException("AttachmentPreviewUnsupported", "This page is too large to run as a preview.", "ERR_ATTACHMENT_PREVIEW_UNSUPPORTED")
      }
      val intent = Intent(activity, PulpoWebPreviewActivity::class.java)
        .putExtra(PulpoWebPreviewActivity.EXTRA_PATH, canonical)
        .putExtra(PulpoWebPreviewActivity.EXTRA_TITLE, title)
        .putExtra(PulpoWebPreviewActivity.EXTRA_POLICY, contentSecurityPolicy)
      activity.runOnUiThread { activity.startActivity(intent) }
    }
  }
}
