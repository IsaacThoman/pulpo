import ExpoModulesCore

struct DocEditorToolbarOptionRecord: Record {
  @Field var command: String = ""
  @Field var label: String = ""
  @Field var systemImage: String = ""
}

struct DocEditorToolbarItemRecord: Record {
  @Field var command: String = ""
  @Field var label: String = ""
  @Field var systemImage: String = ""
  /** Present for a menu, whose choices these are. */
  @Field var options: [DocEditorToolbarOptionRecord] = []
  @Field var separatorBefore: Bool = false
}

struct DocEditorToolbarState: Record {
  @Field var visible: Bool = false
  @Field var active: [String] = []
  @Field var disabled: [String] = []
  @Field var tint: String = "#007AFF"
  /** A live format's own buttons; empty shows the document editor's formatting bar. */
  @Field var items: [DocEditorToolbarItemRecord] = []
}

public final class PulpoDocEditorModule: Module {
  /** Final states pulled from editors being torn down arrive here, after their views are gone. */
  static weak var current: PulpoDocEditorModule?

  public func definition() -> ModuleDefinition {
    Name("PulpoDocEditor")
    Events("onFinalState")

    OnCreate {
      PulpoDocEditorModule.current = self
    }

    View(PulpoDocEditorView.self) {
      Events("onMessage", "onTerminate", "onToolbarAction")

      Prop("instanceId") { (view, value: String) in
        view.instanceId = value
      }
      Prop("html") { (view, value: String) in
        view.load(html: value)
      }
      Prop("pageBackground") { (view, value: String) in
        view.setPageBackground(hex: value)
      }
      Prop("toolbar") { (view, value: DocEditorToolbarState) in
        view.configureToolbar(value)
      }

      AsyncFunction("postMessage") { (view: PulpoDocEditorView, message: String) in
        view.post(message)
      }
      AsyncFunction("showFind") { (view: PulpoDocEditorView) in
        view.showFind()
      }
      AsyncFunction("dismissKeyboard") { (view: PulpoDocEditorView) in
        view.dismissKeyboard()
      }
    }
  }

  func sendFinalState(instanceId: String, state: String?) {
    sendEvent("onFinalState", ["instanceId": instanceId, "state": state as Any])
  }
}
