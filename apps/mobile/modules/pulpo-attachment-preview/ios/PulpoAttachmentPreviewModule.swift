import ExpoModulesCore
import QuickLook
import UIKit

private struct PulpoImageTransitionFrame: Record {
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var width: Double = 0
  @Field var height: Double = 0
  @Field var cornerRadius: Double = 0

  var rect: CGRect {
    CGRect(x: x, y: y, width: width, height: height)
  }
}

private struct PulpoImageGalleryItem: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var uri: URL?
}

private final class PulpoPreviewItem: NSObject, QLPreviewItem {
  let id: String
  let previewItemURL: URL?
  let previewItemTitle: String?

  init(id: String = UUID().uuidString, url: URL, title: String) {
    self.id = id
    previewItemURL = url
    previewItemTitle = title
  }
}

private final class PulpoImageGalleryCoordinator: NSObject, QLPreviewControllerDataSource, QLPreviewControllerDelegate, UIAdaptivePresentationControllerDelegate {
  let items: [PulpoPreviewItem]
  let initialItemID: String
  let previewController = QLPreviewController()
  let sourceFrame: CGRect?
  weak var sourceView: UIView?
  var onDismiss: (() -> Void)?
  private var dismissed = false

  init(items: [PulpoPreviewItem], initialIndex: Int, sourceFrame: CGRect?, sourceView: UIView?) {
    self.items = items
    let safeInitialIndex = min(max(0, initialIndex), max(0, items.count - 1))
    initialItemID = items[safeInitialIndex].id
    self.sourceFrame = sourceFrame
    self.sourceView = sourceView
    super.init()
    previewController.dataSource = self
    previewController.delegate = self
    previewController.currentPreviewItemIndex = safeInitialIndex
    previewController.modalPresentationStyle = .fullScreen
  }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { items.count }

  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
    items[index]
  }

  func previewController(
    _ controller: QLPreviewController,
    frameFor item: any QLPreviewItem,
    inSourceView view: AutoreleasingUnsafeMutablePointer<UIView?>
  ) -> CGRect {
    guard
      let previewItem = item as? PulpoPreviewItem,
      previewItem.id == initialItemID,
      let sourceFrame,
      let sourceView
    else { return .zero }
    view.pointee = sourceView
    return sourceFrame
  }

  func previewController(
    _ controller: QLPreviewController,
    transitionImageFor item: any QLPreviewItem,
    contentRect: UnsafeMutablePointer<CGRect>
  ) -> UIImage? {
    guard
      let previewItem = item as? PulpoPreviewItem,
      previewItem.id == initialItemID,
      let url = previewItem.previewItemURL,
      let image = UIImage(contentsOfFile: url.path)
    else { return nil }
    contentRect.pointee = CGRect(origin: .zero, size: image.size)
    return image
  }

  func previewControllerDidDismiss(_ controller: QLPreviewController) {
    finishDismissal()
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    finishDismissal()
  }

  private func finishDismissal() {
    guard !dismissed else { return }
    dismissed = true
    onDismiss?()
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
  private var activeImageGallery: PulpoImageGalleryCoordinator?
  private var activeImageTransition: UIViewPropertyAnimator?
  private weak var activeImageTransitionOverlay: UIView?

  public func definition() -> ModuleDefinition {
    Name("PulpoAttachmentPreview")

    AsyncFunction("previewImages") { (
      values: [PulpoImageGalleryItem],
      initialIndex: Int,
      sourceFrame: PulpoImageTransitionFrame?
    ) in
      if let activeGallery = self.activeImageGallery {
        let controllerVisible = activeGallery.previewController.presentingViewController != nil
          || activeGallery.previewController.viewIfLoaded?.window != nil
        if controllerVisible { return }
        self.activeImageGallery = nil
      }
      guard self.activePreview == nil else {
        throw Exception(
          name: "AttachmentPreviewBusy",
          description: "Another attachment preview is already open.",
          code: "ERR_ATTACHMENT_PREVIEW_BUSY"
        )
      }
      guard !values.isEmpty else {
        throw Exception(
          name: "AttachmentPreviewMissingFile",
          description: "There are no images available to preview.",
          code: "ERR_ATTACHMENT_PREVIEW_MISSING_FILE"
        )
      }
      let items = try values.map { value in
        guard
          let uri = value.uri,
          uri.isFileURL,
          FileManager.default.fileExists(atPath: uri.path)
        else {
          throw Exception(
            name: "AttachmentPreviewMissingFile",
            description: "An image is no longer available.",
            code: "ERR_ATTACHMENT_PREVIEW_MISSING_FILE"
          )
        }
        let item = PulpoPreviewItem(id: value.id, url: uri, title: value.title)
        guard QLPreviewController.canPreview(item) else {
          throw Exception(
            name: "AttachmentPreviewUnsupported",
            description: "iOS cannot preview this image type.",
            code: "ERR_ATTACHMENT_PREVIEW_UNSUPPORTED"
          )
        }
        return item
      }
      guard
        let presenter = self.appContext?.utilities?.currentViewController(),
        let window = presenter.viewIfLoaded?.window
      else {
        throw Exception(
          name: "AttachmentPreviewUnavailable",
          description: "The image preview could not be presented.",
          code: "ERR_ATTACHMENT_PREVIEW_UNAVAILABLE"
        )
      }

      let coordinator = PulpoImageGalleryCoordinator(
        items: items,
        initialIndex: initialIndex,
        sourceFrame: sourceFrame?.rect,
        sourceView: window
      )
      coordinator.onDismiss = { [weak self, weak coordinator] in
        guard let self, self.activeImageGallery === coordinator else { return }
        self.activeImageGallery = nil
      }
      self.activeImageGallery = coordinator
      presenter.present(coordinator.previewController, animated: true) {
        coordinator.previewController.presentationController?.delegate = coordinator
      }
    }
    .runOnQueue(.main)

    AsyncFunction("animateImageTransition") { (
      uri: URL,
      fromFrame: PulpoImageTransitionFrame,
      toFrame: PulpoImageTransitionFrame,
      opening: Bool,
      promise: Promise
    ) in
      guard self.activeImageTransition == nil else {
        promise.reject(Exception(
          name: "AttachmentImageTransitionBusy",
          description: "Another image transition is already running.",
          code: "ERR_ATTACHMENT_IMAGE_TRANSITION_BUSY"
        ))
        return
      }
      guard uri.isFileURL, let image = UIImage(contentsOfFile: uri.path) else {
        promise.reject(Exception(
          name: "AttachmentImageTransitionMissingImage",
          description: "The transition image is no longer available.",
          code: "ERR_ATTACHMENT_IMAGE_TRANSITION_MISSING_IMAGE"
        ))
        return
      }
      guard
        fromFrame.width > 0,
        fromFrame.height > 0,
        toFrame.width > 0,
        toFrame.height > 0,
        let presenter = self.appContext?.utilities?.currentViewController(),
        let window = presenter.viewIfLoaded?.window
      else {
        promise.reject(Exception(
          name: "AttachmentImageTransitionUnavailable",
          description: "The image transition could not be presented.",
          code: "ERR_ATTACHMENT_IMAGE_TRANSITION_UNAVAILABLE"
        ))
        return
      }

      let overlay = UIView(frame: window.bounds)
      overlay.backgroundColor = .clear
      overlay.isUserInteractionEnabled = false
      overlay.accessibilityElementsHidden = true

      let backdrop = UIView(frame: overlay.bounds)
      backdrop.backgroundColor = .black
      backdrop.alpha = opening ? 0 : 1
      overlay.addSubview(backdrop)

      let imageView = UIImageView(image: image)
      imageView.contentMode = .scaleAspectFill
      imageView.clipsToBounds = true
      imageView.frame = opening ? fromFrame.rect : toFrame.rect
      imageView.layer.cornerCurve = .continuous
      imageView.layer.cornerRadius = CGFloat(opening ? fromFrame.cornerRadius : toFrame.cornerRadius)
      overlay.addSubview(imageView)
      window.addSubview(overlay)

      let animator = UIViewPropertyAnimator(duration: 0.42, dampingRatio: 0.88) {
        backdrop.alpha = opening ? 1 : 0
        imageView.frame = opening ? toFrame.rect : fromFrame.rect
        imageView.layer.cornerRadius = CGFloat(opening ? toFrame.cornerRadius : fromFrame.cornerRadius)
      }
      self.activeImageTransition = animator
      self.activeImageTransitionOverlay = overlay
      animator.addCompletion { [weak self, weak overlay] _ in
        overlay?.removeFromSuperview()
        self?.activeImageTransition = nil
        self?.activeImageTransitionOverlay = nil
        promise.resolve()
      }
      animator.startAnimation()
    }
    .runOnQueue(.main)

    AsyncFunction("previewFile") { (uri: URL, title: String) in
      guard activePreview == nil, activeImageGallery == nil else {
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
