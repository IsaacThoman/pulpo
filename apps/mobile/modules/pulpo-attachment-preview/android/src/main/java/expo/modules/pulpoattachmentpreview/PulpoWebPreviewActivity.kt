package expo.modules.pulpoattachmentpreview

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.util.UUID

/*
 * Untrusted HTML (attachments, Files pages, notebooks) runs here. As on iOS, the page is served from an
 * address only this activity answers (`https://<random>.pulpo-preview.invalid/`, a reserved domain that
 * never resolves) with the sandbox Content-Security-Policy as a response header, so it gets an opaque
 * origin: no cookies, storage, or access to anything of the app's. The web view has no JavaScript
 * bridge, no file or content access, no storage, and cannot navigate away; links open in the browser.
 */
class PulpoWebPreviewActivity : Activity() {
  private var webView: WebView? = null
  private lateinit var container: FrameLayout
  private lateinit var document: File
  private lateinit var policy: String
  private val host = "${UUID.randomUUID()}.pulpo-preview.invalid"
  private val documentUrl get() = "https://$host/"
  private var restartedAfterCrash = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val path = intent.getStringExtra(EXTRA_PATH)
    val contentPolicy = intent.getStringExtra(EXTRA_POLICY)
    if (path == null || contentPolicy == null || !contentPolicy.startsWith("sandbox ")) {
      finish()
      return
    }
    document = File(path)
    policy = contentPolicy
    title = intent.getStringExtra(EXTRA_TITLE) ?: ""

    val dark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    val background = if (dark) Color.rgb(18, 18, 20) else Color.WHITE
    val foreground = if (dark) Color.rgb(240, 240, 242) else Color.rgb(17, 17, 20)
    window.statusBarColor = background
    window.navigationBarColor = background
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !dark) {
      @Suppress("DEPRECATION")
      window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
    }

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(background)
    }
    val header = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(8), dp(4), dp(16), dp(4))
      minimumHeight = dp(56)
    }
    val close = Button(this, null, android.R.attr.borderlessButtonStyle).apply {
      text = "Done"
      isAllCaps = false
      setTextColor(if (dark) Color.rgb(101, 167, 255) else Color.rgb(7, 95, 190))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
      contentDescription = "Close preview"
      setOnClickListener { finish() }
    }
    val heading = TextView(this).apply {
      text = this@PulpoWebPreviewActivity.title
      setTextColor(foreground)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
      typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
      setPadding(dp(8), 0, 0, 0)
    }
    header.addView(close, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    header.addView(heading, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    container = FrameLayout(this)
    root.addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    root.addView(container, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
    // Drawn edge to edge on Android 15 and later: keep the header and page clear of the system bars.
    root.setOnApplyWindowInsetsListener { view, insets ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
        view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      } else {
        @Suppress("DEPRECATION")
        view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
      }
      insets
    }
    setContentView(root)
    load()
  }

  private fun dp(value: Int): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

  private fun load() {
    webView?.let {
      container.removeView(it)
      it.destroy()
    }
    val view = makeWebView()
    webView = view
    container.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    view.loadUrl(documentUrl)
  }

  private fun isDocument(uri: Uri): Boolean = uri.scheme == "https" && uri.host == host && (uri.path.isNullOrEmpty() || uri.path == "/")

  private fun makeWebView(): WebView {
    val view = WebView(this)
    view.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = false
      databaseEnabled = false
      allowFileAccess = false
      allowContentAccess = false
      javaScriptCanOpenWindowsAutomatically = false
      setSupportMultipleWindows(false)
      mediaPlaybackRequiresUserGesture = true
      cacheMode = WebSettings.LOAD_NO_CACHE
      setGeolocationEnabled(false)
      saveFormData = false
      setSupportZoom(true)
      builtInZoomControls = true
      displayZoomControls = false
      useWideViewPort = true
      loadWithOverviewMode = true
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) safeBrowsingEnabled = true
    }
    CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)
    view.webChromeClient = WebChromeClient()
    view.webViewClient = object : WebViewClient() {
      override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        if (request.url.host != host) return null
        val headers = mapOf(
          "Cache-Control" to "no-store",
          "Content-Security-Policy" to policy,
          "Referrer-Policy" to "no-referrer",
          "X-Content-Type-Options" to "nosniff",
        )
        // Relative resources aren't part of the page, so only the document itself is served.
        if (!isDocument(request.url) || request.method != "GET") {
          return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, ByteArrayInputStream(ByteArray(0)))
        }
        return WebResourceResponse("text/html", "utf-8", 200, "OK", headers, FileInputStream(document))
      }

      // The page may reload itself; anything else leaves the preview, and links the user taps open in the browser.
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        if (request.isForMainFrame && isDocument(request.url)) return false
        val scheme = request.url.scheme
        if (request.hasGesture() && request.isForMainFrame && (scheme == "https" || scheme == "http" || scheme == "mailto")) {
          try {
            startActivity(Intent(Intent.ACTION_VIEW, request.url).addCategory(Intent.CATEGORY_BROWSABLE))
          } catch (_: ActivityNotFoundException) {
            // Nothing can open it; the tap does nothing.
          }
        }
        return true
      }

      override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        // A page that crashes its renderer twice is not tried again.
        if (restartedAfterCrash) finish() else {
          restartedAfterCrash = true
          load()
        }
        return true
      }
    }
    return view
  }

  override fun onDestroy() {
    webView?.let {
      container.removeView(it)
      it.destroy()
    }
    webView = null
    super.onDestroy()
  }

  companion object {
    const val EXTRA_PATH = "expo.modules.pulpoattachmentpreview.PATH"
    const val EXTRA_TITLE = "expo.modules.pulpoattachmentpreview.TITLE"
    const val EXTRA_POLICY = "expo.modules.pulpoattachmentpreview.POLICY"
  }
}
