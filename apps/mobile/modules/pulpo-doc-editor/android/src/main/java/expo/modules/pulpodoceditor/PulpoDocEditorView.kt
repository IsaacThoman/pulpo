package expo.modules.pulpodoceditor

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONObject
import org.json.JSONTokener

/*
 * Hosts the document editor page (built from apps/mobile/editor). The page is loaded from memory under
 * an origin of its own, with a CSP that loads nothing from anywhere, and talks to the app only through
 * the `pulpoEditorAndroid` channel. The app owns the document; the page is a replica, so this view can
 * rebuild it whenever the renderer process goes away.
 */
private const val EDITOR_ORIGIN = "https://pulpo-editor.local"
private const val EDITOR_URL = "$EDITOR_ORIGIN/editor/index.html"
private const val CHANNEL = "pulpoEditorAndroid"

@SuppressLint("SetJavaScriptEnabled", "ViewConstructor")
class PulpoDocEditorView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onMessage by EventDispatcher()
  private val onTerminate by EventDispatcher()
  @Suppress("unused") private val onToolbarAction by EventDispatcher()

  var instanceId = ""
  private var html: String? = null
  private var loadedHtml: String? = null
  private var background = Color.TRANSPARENT
  private var webView: WebView = makeWebView()
  private var finalStateSent = false
  private var finalStatePending = false
  private var destroyed = false
  private val main = Handler(Looper.getMainLooper())

  init {
    addView(webView, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  private fun makeWebView(): WebView {
    val view = WebView(context)
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
      setSupportZoom(false)
      builtInZoomControls = false
      displayZoomControls = false
    }
    view.setBackgroundColor(background)
    view.isVerticalScrollBarEnabled = true
    view.overScrollMode = OVER_SCROLL_IF_CONTENT_SCROLLS
    view.webViewClient = object : WebViewClient() {
      // The page itself only; links are opened by the app (the editor reports taps on them).
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true

      override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        main.post { replaceWebView() }
        return true
      }
    }
    if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      // Only the editor's own origin can post to the app.
      WebViewCompat.addWebMessageListener(view, CHANNEL, setOf(EDITOR_ORIGIN)) { _, message, sourceOrigin, isMainFrame, _ ->
        val data = message.data
        if (isMainFrame && sourceOrigin.toString() == EDITOR_ORIGIN && data != null) onMessage(mapOf("data" to data))
      }
    } else {
      view.addJavascriptInterface(object {
        @JavascriptInterface
        fun postMessage(data: String) {
          main.post { onMessage(mapOf("data" to data)) }
        }
      }, CHANNEL)
    }
    return view
  }

  /** The renderer process ended: the old web view cannot be used again, so a new one loads the page. */
  private fun replaceWebView() {
    val dead = webView
    removeView(dead)
    dead.destroy()
    // A final state asked of the dead page never comes: the app stops waiting for it.
    if (finalStatePending) {
      finalStatePending = false
      PulpoDocEditorModule.current?.sendFinalState(instanceId, null)
    }
    // Torn down meanwhile: nothing is shown any more, so no new page is started.
    if (destroyed) return
    finalStateSent = false
    webView = makeWebView()
    addView(webView, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    // React Native lays out this view's children only once; the new one is sized here, or it stays empty.
    measureAndLayout()
    onTerminate(mapOf<String, Any>())
    loadedHtml = null
    html?.let { load(it) }
  }

  fun load(value: String) {
    html = value
    if (value == loadedHtml) return
    loadedHtml = value
    webView.loadDataWithBaseURL(EDITOR_URL, value, "text/html", "utf-8", null)
  }

  fun setPageBackground(hex: String) {
    background = try { Color.parseColor(hex) } catch (_: IllegalArgumentException) { Color.TRANSPARENT }
    setBackgroundColor(background)
    webView.setBackgroundColor(background)
  }

  fun post(message: String) {
    // A JSON string is a JavaScript string literal once quoted.
    webView.evaluateJavascript("window.pulpoEditor && window.pulpoEditor.receive(${JSONObject.quote(message)})", null)
  }

  fun dismissKeyboard() {
    webView.clearFocus()
    val input = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    input.hideSoftInputFromWindow(webView.windowToken, 0)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    finalStateSent = false
  }

  /*
   * Leaving the screen: the page may hold an edit whose message is still on its way, so its whole state is
   * pulled one last time and handed to the app, which merges it (merges are idempotent).
   */
  override fun onDetachedFromWindow() {
    sendFinalState()
    super.onDetachedFromWindow()
  }

  private fun sendFinalState() {
    if (finalStateSent || loadedHtml == null || destroyed) return
    finalStateSent = true
    finalStatePending = true
    val id = instanceId
    val view = webView
    view.evaluateJavascript("window.pulpoEditorState ? window.pulpoEditorState() : null") { result ->
      val state = try { JSONTokener(result ?: "null").nextValue() as? String } catch (_: Exception) { null }
      PulpoDocEditorModule.current?.sendFinalState(id, state)
      finalStatePending = false
      // The view outlived its screen only to answer.
      if (destroyed) view.destroy()
    }
  }

  /** React Native removed the view for good; the web view goes once any final state was answered. */
  fun cleanup() {
    if (destroyed) return
    sendFinalState()
    destroyed = true
    if (!finalStatePending) webView.destroy()
  }
}
