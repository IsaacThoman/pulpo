import ExpoModulesCore
import QuickLook
import UIKit

private final class PulpoPreviewItem: NSObject, QLPreviewItem {
  let previewItemURL: URL?
  let previewItemTitle: String?

  init(url: URL, title: String) {
    previewItemURL = url
    previewItemTitle = title
  }
}

private final class PulpoPreviewCoordinator: NSObject, QLPreviewControllerDataSource, UIAdaptivePresentationControllerDelegate {
  let item: PulpoPreviewItem
  let previewController = QLPreviewController()
  let navigationController: UINavigationController
  var onDismiss: (() -> Void)?

  init(item: PulpoPreviewItem) {
    self.item = item
    navigationController = UINavigationController(rootViewController: previewController)
    super.init()
    previewController.dataSource = self
    previewController.loadViewIfNeeded()
    previewController.navigationItem.leftBarButtonItem = UIBarButtonItem(
      barButtonSystemItem: .done,
      target: self,
      action: #selector(close)
    )
    navigationController.modalPresentationStyle = .fullScreen
  }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
    item
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    onDismiss?()
  }

  @objc private func close() {
    navigationController.dismiss(animated: true) { [weak self] in self?.onDismiss?() }
  }
}

public final class PulpoAttachmentPreviewModule: Module {
  private var activePreview: PulpoPreviewCoordinator?

  public func definition() -> ModuleDefinition {
    Name("PulpoAttachmentPreview")

    AsyncFunction("previewFile") { (uri: URL, title: String) in
      guard activePreview == nil else {
        throw Exception(
          name: "AttachmentPreviewBusy",
          description: "Another attachment preview is already open.",
          code: "ERR_ATTACHMENT_PREVIEW_BUSY"
        )
      }
      guard uri.isFileURL, FileManager.default.fileExists(atPath: uri.path) else {
        throw Exception(
          name: "AttachmentPreviewMissingFile",
          description: "The attachment file is no longer available.",
          code: "ERR_ATTACHMENT_PREVIEW_MISSING_FILE"
        )
      }
      let item = PulpoPreviewItem(url: uri, title: title)
      guard QLPreviewController.canPreview(item) else {
        throw Exception(
          name: "AttachmentPreviewUnsupported",
          description: "iOS cannot preview this file type.",
          code: "ERR_ATTACHMENT_PREVIEW_UNSUPPORTED"
        )
      }
      guard let presenter = appContext?.utilities?.currentViewController() else {
        throw Exception(
          name: "AttachmentPreviewUnavailable",
          description: "The attachment preview could not be presented.",
          code: "ERR_ATTACHMENT_PREVIEW_UNAVAILABLE"
        )
      }

      let coordinator = PulpoPreviewCoordinator(item: item)
      coordinator.onDismiss = { [weak self, weak coordinator] in
        guard let self, self.activePreview === coordinator else { return }
        self.activePreview = nil
      }
      activePreview = coordinator
      presenter.present(coordinator.navigationController, animated: true) {
        coordinator.navigationController.presentationController?.delegate = coordinator
      }
    }
    .runOnQueue(.main)
  }
}
