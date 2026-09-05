import ExpoModulesCore
import UIKit

private final class ClipboardFileNotFoundException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "The file does not exist at \(param)"
  }
}

private final class ClipboardItemProviderException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "Could not create a pasteboard item provider for \(param)"
  }
}

public final class PulpoFileClipboardModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PulpoFileClipboard")

    AsyncFunction("copyFile") { (uri: URL) in
      guard uri.isFileURL, FileManager.default.fileExists(atPath: uri.path) else {
        throw ClipboardFileNotFoundException(uri.absoluteString)
      }
      guard let provider = NSItemProvider(contentsOf: uri) else {
        throw ClipboardItemProviderException(uri.absoluteString)
      }
      UIPasteboard.general.setItemProviders([provider], localOnly: false, expirationDate: nil)
    }
    .runOnQueue(DispatchQueue.main)

    View(QueuedMessagesView.self) {
      Events("onAction", "onContentHeightChange")
      Prop("rows") { (view, value: [QueuedMessageRow]) in
        view.setRows(value)
      }
    }

    View(TemporaryChatHeaderView.self) {
      Events("onToggleExpiration", "onToggleTemporary", "onSave", "onNewChat")

      Prop("active") { (view, value: Bool) in
        view.setActive(value)
      }
      Prop("expanded") { (view, value: Bool) in
        view.setExpanded(value)
      }
      Prop("expirationEnabled") { (view, value: Bool) in
        view.setExpirationEnabled(value)
      }
      Prop("leadingAction") { (view, value: String) in
        view.setLeadingAction(value)
      }
      Prop("saving") { (view, value: Bool) in
        view.setSaving(value)
      }
      Prop("saveDisabled") { (view, value: Bool) in
        view.setSaveDisabled(value)
      }
      Prop("trailingAction") { (view, value: String) in
        view.setTrailingAction(value)
      }
      Prop("reduceMotion") { (view, value: Bool) in
        view.setReduceMotion(value)
      }
    }

    View(HistoryChatContextMenuView.self) {
      Events("onAction", "onChatPress", "onPreviewRequest")

      Prop("pinned") { (view, value: Bool) in
        view.setPinned(value)
      }
      Prop("removeChatLabel") { (view, value: String) in
        view.setRemoveChatLabel(value)
      }
      Prop("expirationAction") { (view, value: String) in
        view.setExpirationAction(value)
      }
      Prop("expirationPeriodLabel") { (view, value: String) in
        view.setExpirationPeriodLabel(value)
      }
      Prop("expiresAt") { (view, value: Double) in
        view.setExpiresAt(value)
      }
      Prop("previewTitle") { (view, value: String) in
        view.setPreviewTitle(value)
      }
      Prop("previewModelName") { (view, value: String) in
        view.setPreviewModelName(value)
      }
      Prop("previewModelImageURI") { (view, value: String) in
        view.setPreviewModelImageURI(value)
      }
      Prop("previewBody") { (view, value: String) in
        view.setPreviewBody(value)
      }
      Prop("previewMetadata") { (view, value: String) in
        view.setPreviewMetadata(value)
      }
    }
  }
}
