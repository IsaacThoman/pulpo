package expo.modules.pulpodoceditor

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class DocEditorToolbarState : Record {
  @Field var visible: Boolean = false
  @Field var active: List<String> = emptyList()
  @Field var disabled: List<String> = emptyList()
  @Field var tint: String = "#007AFF"
}

class PulpoDocEditorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PulpoDocEditor")
    Events("onFinalState")

    OnCreate { current = this@PulpoDocEditorModule }
    OnDestroy { if (current === this@PulpoDocEditorModule) current = null }

    View(PulpoDocEditorView::class) {
      Events("onMessage", "onTerminate", "onToolbarAction")

      Prop("instanceId") { view: PulpoDocEditorView, value: String -> view.instanceId = value }
      Prop("html") { view: PulpoDocEditorView, value: String -> view.load(value) }
      Prop("pageBackground") { view: PulpoDocEditorView, value: String -> view.setPageBackground(value) }
      // The formatting bar is drawn by React Native above the keyboard on Android.
      Prop("toolbar") { _: PulpoDocEditorView, _: DocEditorToolbarState -> }

      OnViewDestroys { view: PulpoDocEditorView -> view.cleanup() }

      AsyncFunction("postMessage") { view: PulpoDocEditorView, message: String -> view.post(message) }
      AsyncFunction("showFind") { _: PulpoDocEditorView -> }
      AsyncFunction("dismissKeyboard") { view: PulpoDocEditorView -> view.dismissKeyboard() }
    }
  }

  fun sendFinalState(instanceId: String, state: String?) {
    sendEvent("onFinalState", mapOf("instanceId" to instanceId, "state" to state))
  }

  companion object {
    /** Final states pulled from editors being torn down arrive after their views are gone. */
    var current: PulpoDocEditorModule? = null
  }
}
