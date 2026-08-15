import ExpoModulesCore
import QuickLook
import UIKit

private struct PulpoImageTransitionFrame: Record {
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var width: Double = 0
  @Field var height: Double = 0
  @Field var cornerRadius: Double = 0
  @Field var sourceNativeId: String?

  var rect: CGRect {
    CGRect(x: x, y: y, width: width, height: height)
  }
}

private func findNativeView(with id: String?, in rootView: UIView) -> UIView? {
  guard let id, !id.isEmpty else { return nil }
  for key in ["nativeId", "nativeID"] {
    let selector = NSSelectorFromString(key)
    if rootView.responds(to: selector), rootView.value(forKey: key) as? String == id {
      return rootView
    }
  }
  for subview in rootView.subviews {
    if let match = findNativeView(with: id, in: subview) { return match }
  }
  return nil
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

private func fittedRect(for imageSize: CGSize, in bounds: CGRect) -> CGRect? {
  guard imageSize.width > 0, imageSize.height > 0, bounds.width > 0, bounds.height > 0 else {
    return nil
  }
  let scale = min(bounds.width / imageSize.width, bounds.height / imageSize.height)
  let size = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
  return CGRect(
    x: bounds.midX - size.width / 2,
    y: bounds.midY - size.height / 2,
    width: size.width,
    height: size.height
  )
}

private final class PulpoZoomingImageCell: UICollectionViewCell, UIScrollViewDelegate {
  static let reuseIdentifier = "PulpoZoomingImageCell"

  private let scrollView = UIScrollView()
  private let imageView = UIImageView()
  private var imageSize = CGSize.zero
  private var laidOutSize = CGSize.zero

  var isAtMinimumZoom: Bool {
    abs(scrollView.zoomScale - scrollView.minimumZoomScale) < 0.01
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    contentView.backgroundColor = .clear
    scrollView.backgroundColor = .clear
    scrollView.contentInsetAdjustmentBehavior = .never
    scrollView.decelerationRate = .fast
    scrollView.delegate = self
    scrollView.showsHorizontalScrollIndicator = false
    scrollView.showsVerticalScrollIndicator = false
    scrollView.alwaysBounceHorizontal = false
    scrollView.alwaysBounceVertical = false
    scrollView.bouncesZoom = true
    scrollView.panGestureRecognizer.isEnabled = false
    imageView.contentMode = .scaleAspectFit
    imageView.isUserInteractionEnabled = false
    imageView.isAccessibilityElement = true
    imageView.accessibilityTraits = .image
    scrollView.addSubview(imageView)
    contentView.addSubview(scrollView)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func prepareForReuse() {
    super.prepareForReuse()
    imageView.image = nil
    imageSize = .zero
    laidOutSize = .zero
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    scrollView.frame = contentView.bounds
    guard imageSize != .zero, laidOutSize != bounds.size else { return }
    laidOutSize = bounds.size
    configureZoomScales()
  }

  func configure(image: UIImage, title: String) {
    imageView.image = image
    imageSize = image.size
    imageView.accessibilityLabel = title
    laidOutSize = .zero
    setNeedsLayout()
  }

  func toggleZoom(at point: CGPoint, animated: Bool) {
    guard imageSize != .zero else { return }
    if isAtMinimumZoom {
      let targetScale = min(scrollView.maximumZoomScale, scrollView.minimumZoomScale * 2.5)
      let pointInImage = imageView.convert(point, from: scrollView)
      let zoomSize = CGSize(
        width: scrollView.bounds.width / targetScale,
        height: scrollView.bounds.height / targetScale
      )
      scrollView.zoom(
        to: CGRect(
          x: pointInImage.x - zoomSize.width / 2,
          y: pointInImage.y - zoomSize.height / 2,
          width: zoomSize.width,
          height: zoomSize.height
        ),
        animated: animated
      )
    } else {
      scrollView.setZoomScale(scrollView.minimumZoomScale, animated: animated)
    }
  }

  func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

  func scrollViewDidZoom(_ scrollView: UIScrollView) {
    centerImage()
    scrollView.panGestureRecognizer.isEnabled = !isAtMinimumZoom
  }

  private func configureZoomScales() {
    guard imageSize.width > 0, imageSize.height > 0, bounds.width > 0, bounds.height > 0 else { return }
    imageView.transform = .identity
    imageView.frame = CGRect(origin: .zero, size: imageSize)
    scrollView.contentSize = imageSize
    let minimumScale = min(bounds.width / imageSize.width, bounds.height / imageSize.height)
    scrollView.maximumZoomScale = max(minimumScale * 4, minimumScale)
    scrollView.minimumZoomScale = minimumScale
    scrollView.zoomScale = minimumScale
    scrollView.panGestureRecognizer.isEnabled = false
    centerImage()
  }

  private func centerImage() {
    let scaledSize = CGSize(
      width: imageSize.width * scrollView.zoomScale,
      height: imageSize.height * scrollView.zoomScale
    )
    scrollView.contentInset = UIEdgeInsets(
      top: max(0, (scrollView.bounds.height - scaledSize.height) / 2),
      left: max(0, (scrollView.bounds.width - scaledSize.width) / 2),
      bottom: 0,
      right: 0
    )
  }
}

private final class PulpoImageGalleryViewController: UIViewController, UICollectionViewDataSource, UICollectionViewDelegateFlowLayout {
  let items: [PulpoPreviewItem]
  let images: [UIImage]
  let initialIndex: Int
  var onDidDismiss: (() -> Void)?

  private let collectionView: UICollectionView
  private let layout = UICollectionViewFlowLayout()
  private let controlsView = UIView()
  private let closeButton = UIButton(type: .system)
  private let titleButton = UIButton(type: .system)
  private let shareButton = UIButton(type: .system)
  private var currentIndex: Int
  private var lastLayoutSize = CGSize.zero
  private var didRevealControls = false
  private var didFinishDismissal = false
  private var controlsAreVisible = true

  var currentIndexForTransition: Int { currentIndex }

  var currentCell: PulpoZoomingImageCell? {
    collectionView.cellForItem(at: IndexPath(item: currentIndex, section: 0)) as? PulpoZoomingImageCell
  }

  init(items: [PulpoPreviewItem], images: [UIImage], initialIndex: Int) {
    self.items = items
    self.images = images
    let safeInitialIndex = min(max(0, initialIndex), max(0, items.count - 1))
    self.initialIndex = safeInitialIndex
    currentIndex = safeInitialIndex
    layout.scrollDirection = .horizontal
    layout.minimumLineSpacing = 0
    layout.minimumInteritemSpacing = 0
    collectionView = UICollectionView(frame: .zero, collectionViewLayout: layout)
    super.init(nibName: nil, bundle: nil)
    modalPresentationStyle = .fullScreen
    modalPresentationCapturesStatusBarAppearance = true
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override var prefersStatusBarHidden: Bool { true }
  override var prefersHomeIndicatorAutoHidden: Bool { true }
  override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
    UIDevice.current.userInterfaceIdiom == .pad ? .all : .portrait
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black

    collectionView.backgroundColor = .clear
    collectionView.contentInsetAdjustmentBehavior = .never
    collectionView.dataSource = self
    collectionView.delegate = self
    collectionView.decelerationRate = .fast
    collectionView.isPagingEnabled = true
    collectionView.showsHorizontalScrollIndicator = false
    collectionView.register(PulpoZoomingImageCell.self, forCellWithReuseIdentifier: PulpoZoomingImageCell.reuseIdentifier)
    collectionView.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(collectionView)
    NSLayoutConstraint.activate([
      collectionView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      collectionView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      collectionView.topAnchor.constraint(equalTo: view.topAnchor),
      collectionView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])

    configureControls()
    configureGestures()
    updateTitleControl()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    guard view.bounds.size != lastLayoutSize else { return }
    lastLayoutSize = view.bounds.size
    layout.itemSize = view.bounds.size
    layout.invalidateLayout()
    collectionView.layoutIfNeeded()
    collectionView.setContentOffset(
      CGPoint(x: view.bounds.width * CGFloat(currentIndex), y: 0),
      animated: false
    )
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !didRevealControls else { return }
    didRevealControls = true
    if UIAccessibility.isReduceMotionEnabled {
      controlsView.alpha = 1
      controlsView.transform = .identity
    } else {
      UIView.animate(withDuration: 0.2, delay: 0, options: [.curveEaseOut, .beginFromCurrentState]) {
        self.controlsView.alpha = 1
        self.controlsView.transform = .identity
      }
    }
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    guard presentingViewController == nil || isBeingDismissed else { return }
    finishDismissal()
  }

  func numberOfSections(in collectionView: UICollectionView) -> Int { 1 }

  func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
    items.count
  }

  func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
    let cell = collectionView.dequeueReusableCell(
      withReuseIdentifier: PulpoZoomingImageCell.reuseIdentifier,
      for: indexPath
    ) as! PulpoZoomingImageCell
    cell.configure(image: images[indexPath.item], title: items[indexPath.item].previewItemTitle ?? "Image")
    return cell
  }

  func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
    updateCurrentIndex()
  }

  func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
    if !decelerate { updateCurrentIndex() }
  }

  private func configureControls() {
    controlsView.translatesAutoresizingMaskIntoConstraints = false
    controlsView.alpha = 0
    controlsView.transform = CGAffineTransform(translationX: 0, y: -8)
    view.addSubview(controlsView)

    configureIconButton(closeButton, systemName: "xmark", accessibilityLabel: "Close image preview")
    closeButton.addTarget(self, action: #selector(close), for: .touchUpInside)
    configureIconButton(shareButton, systemName: "square.and.arrow.up", accessibilityLabel: "Share image")
    shareButton.addTarget(self, action: #selector(share), for: .touchUpInside)
    configureTitleButton()

    [closeButton, titleButton, shareButton].forEach {
      $0.translatesAutoresizingMaskIntoConstraints = false
      controlsView.addSubview($0)
    }

    let titleMaximumWidth: CGFloat = UIDevice.current.userInterfaceIdiom == .pad ? 360 : 280
    NSLayoutConstraint.activate([
      controlsView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
      controlsView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
      controlsView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
      controlsView.heightAnchor.constraint(greaterThanOrEqualToConstant: 50),

      closeButton.leadingAnchor.constraint(equalTo: controlsView.leadingAnchor),
      closeButton.topAnchor.constraint(equalTo: controlsView.topAnchor),
      closeButton.widthAnchor.constraint(equalToConstant: 50),
      closeButton.heightAnchor.constraint(equalToConstant: 50),

      shareButton.trailingAnchor.constraint(equalTo: controlsView.trailingAnchor),
      shareButton.topAnchor.constraint(equalTo: controlsView.topAnchor),
      shareButton.widthAnchor.constraint(equalToConstant: 50),
      shareButton.heightAnchor.constraint(equalToConstant: 50),

      titleButton.centerXAnchor.constraint(equalTo: controlsView.centerXAnchor),
      titleButton.topAnchor.constraint(equalTo: controlsView.topAnchor),
      titleButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 50),
      titleButton.leadingAnchor.constraint(greaterThanOrEqualTo: closeButton.trailingAnchor, constant: 10),
      titleButton.trailingAnchor.constraint(lessThanOrEqualTo: shareButton.leadingAnchor, constant: -10),
      titleButton.widthAnchor.constraint(lessThanOrEqualToConstant: titleMaximumWidth),
    ])
  }

  private func configureIconButton(_ button: UIButton, systemName: String, accessibilityLabel: String) {
    let imageConfiguration = UIImage.SymbolConfiguration(pointSize: 19, weight: .semibold)
    if #available(iOS 26.0, *) {
      var configuration = UIButton.Configuration.glass()
      configuration.image = UIImage(systemName: systemName, withConfiguration: imageConfiguration)
      configuration.baseForegroundColor = .white
      button.configuration = configuration
    } else {
      var configuration = UIButton.Configuration.filled()
      configuration.image = UIImage(systemName: systemName, withConfiguration: imageConfiguration)
      configuration.baseForegroundColor = .white
      configuration.baseBackgroundColor = UIColor(white: 0.18, alpha: 0.9)
      configuration.cornerStyle = .capsule
      button.configuration = configuration
    }
    button.accessibilityLabel = accessibilityLabel
    button.accessibilityTraits = .button
  }

  private func configureTitleButton() {
    var configuration: UIButton.Configuration
    if #available(iOS 26.0, *) {
      configuration = .glass()
    } else {
      configuration = .filled()
      configuration.baseBackgroundColor = UIColor(white: 0.18, alpha: 0.9)
      configuration.cornerStyle = .capsule
    }
    configuration.baseForegroundColor = .white
    configuration.titleAlignment = .center
    configuration.titleLineBreakMode = .byTruncatingMiddle
    configuration.subtitleLineBreakMode = .byTruncatingMiddle
    configuration.contentInsets = NSDirectionalEdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16)
    titleButton.configuration = configuration
    titleButton.showsMenuAsPrimaryAction = true
  }

  private func configureGestures() {
    let singleTap = UITapGestureRecognizer(target: self, action: #selector(toggleControls))
    let doubleTap = UITapGestureRecognizer(target: self, action: #selector(doubleTapImage(_:)))
    doubleTap.numberOfTapsRequired = 2
    singleTap.require(toFail: doubleTap)
    collectionView.addGestureRecognizer(singleTap)
    collectionView.addGestureRecognizer(doubleTap)
  }

  private func updateCurrentIndex() {
    let nextIndex = Int(round(collectionView.contentOffset.x / max(1, collectionView.bounds.width)))
    let boundedIndex = min(max(0, nextIndex), max(0, items.count - 1))
    guard currentIndex != boundedIndex else { return }
    currentIndex = boundedIndex
    updateTitleControl()
    UISelectionFeedbackGenerator().selectionChanged()
  }

  private func updateTitleControl() {
    guard items.indices.contains(currentIndex) else { return }
    var configuration = titleButton.configuration
    let title = items[currentIndex].previewItemTitle ?? "Image"
    configuration?.title = title
    configuration?.subtitle = items.count > 1 ? "\(currentIndex + 1) of \(items.count)" : nil
    titleButton.configuration = configuration
    titleButton.accessibilityLabel = items.count > 1
      ? "\(title), image \(currentIndex + 1) of \(items.count)"
      : title
    titleButton.menu = UIMenu(children: items.enumerated().map { index, item in
      UIAction(
        title: item.previewItemTitle ?? "Image \(index + 1)",
        state: index == currentIndex ? .on : .off
      ) { [weak self] _ in
        self?.showImage(at: index)
      }
    })
  }

  private func showImage(at index: Int) {
    guard items.indices.contains(index) else { return }
    currentIndex = index
    collectionView.scrollToItem(at: IndexPath(item: index, section: 0), at: .centeredHorizontally, animated: true)
    updateTitleControl()
  }

  private func setControlsVisible(_ visible: Bool) {
    controlsAreVisible = visible
    let changes = {
      self.controlsView.alpha = visible ? 1 : 0
      self.controlsView.transform = visible ? .identity : CGAffineTransform(translationX: 0, y: -8)
    }
    guard !UIAccessibility.isReduceMotionEnabled else {
      changes()
      return
    }
    UIView.animate(withDuration: 0.2, delay: 0, options: [.curveEaseInOut, .beginFromCurrentState], animations: changes)
  }

  private func finishDismissal() {
    guard !didFinishDismissal else { return }
    didFinishDismissal = true
    onDidDismiss?()
  }

  @objc private func toggleControls() {
    setControlsVisible(!controlsAreVisible)
  }

  @objc private func doubleTapImage(_ recognizer: UITapGestureRecognizer) {
    let point = recognizer.location(in: currentCell)
    currentCell?.toggleZoom(at: point, animated: !UIAccessibility.isReduceMotionEnabled)
  }

  @objc private func close() {
    dismiss(animated: true) { [weak self] in self?.finishDismissal() }
  }

  @objc private func share() {
    guard items.indices.contains(currentIndex), let url = items[currentIndex].previewItemURL else { return }
    let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
    if let popover = controller.popoverPresentationController {
      popover.sourceView = shareButton
      popover.sourceRect = shareButton.bounds
    }
    present(controller, animated: true)
  }
}

private final class PulpoImageGalleryCoordinator: NSObject {
  let items: [PulpoPreviewItem]
  let initialItemIndex: Int
  let viewController: PulpoImageGalleryViewController
  var onDismiss: (() -> Void)?
  private var dismissed = false
  private let transitionImageSize: CGSize
  private let transitionSourceNativeId: String?
  private weak var transitionSourceWindow: UIWindow?

  init(
    items: [PulpoPreviewItem],
    images: [UIImage],
    initialIndex: Int,
    sourceFrame: PulpoImageTransitionFrame?,
    sourceWindow: UIWindow?
  ) {
    self.items = items
    let safeInitialIndex = min(max(0, initialIndex), max(0, items.count - 1))
    initialItemIndex = safeInitialIndex
    viewController = PulpoImageGalleryViewController(items: items, images: images, initialIndex: safeInitialIndex)
    transitionImageSize = images[safeInitialIndex].size
    transitionSourceNativeId = sourceFrame?.sourceNativeId
    transitionSourceWindow = sourceWindow
    super.init()
    viewController.onDidDismiss = { [weak self] in self?.finishDismissal() }
    viewController.loadViewIfNeeded()
    viewController.view.layoutIfNeeded()

    if
      #available(iOS 18.0, *),
      let sourceWindow,
      findNativeView(with: transitionSourceNativeId, in: sourceWindow) != nil
    {
      let options = UIViewController.Transition.ZoomOptions()
      options.dimmingColor = .black
      options.interactiveDismissShouldBegin = { [weak viewController] context in
        guard let cell = viewController?.currentCell, cell.isAtMinimumZoom else { return false }
        return abs(context.velocity.dy) > abs(context.velocity.dx)
      }
      options.alignmentRectProvider = { [weak self] context in
        guard
          let self,
          self.viewController.currentIndexForTransition == self.initialItemIndex,
          self.transitionImageSize.width > 0,
          self.transitionImageSize.height > 0
        else { return nil }
        return fittedRect(for: self.transitionImageSize, in: context.zoomedViewController.view.bounds)
      }
      viewController.preferredTransition = .zoom(options: options) { [weak self] _ in
        guard
          let self,
          self.viewController.currentIndexForTransition == self.initialItemIndex,
          let sourceWindow = self.transitionSourceWindow
        else { return nil }
        return findNativeView(with: self.transitionSourceNativeId, in: sourceWindow)
      }
    }
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
        let controllerVisible = activeGallery.viewController.presentingViewController != nil
          || activeGallery.viewController.viewIfLoaded?.window != nil
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
      let resolved = try values.map { value -> (PulpoPreviewItem, UIImage) in
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
        guard let image = UIImage(contentsOfFile: uri.path) else {
          throw Exception(
            name: "AttachmentPreviewUnsupported",
            description: "iOS cannot preview this image type.",
            code: "ERR_ATTACHMENT_PREVIEW_UNSUPPORTED"
          )
        }
        return (item, image)
      }
      let items = resolved.map(\.0)
      let images = resolved.map(\.1)
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
        images: images,
        initialIndex: initialIndex,
        sourceFrame: sourceFrame,
        sourceWindow: window
      )
      coordinator.onDismiss = { [weak self, weak coordinator] in
        guard let self, self.activeImageGallery === coordinator else { return }
        self.activeImageGallery = nil
      }
      self.activeImageGallery = coordinator
      presenter.present(coordinator.viewController, animated: true)
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
