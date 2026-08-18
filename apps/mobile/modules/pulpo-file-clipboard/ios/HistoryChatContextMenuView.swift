import ExpoModulesCore
import UIKit

public final class HistoryChatContextMenuView: ExpoView, UIContextMenuInteractionDelegate {
  let onAction = EventDispatcher()
  let onChatPress = EventDispatcher()
  let onPreviewRequest = EventDispatcher()

  private var pinned = false
  private var removeChatLabel = "Delete chat"
  private var expirationAction = "hidden"
  private var expirationPeriodLabel = ""
  private var expiresAt: Double = 0
  private var previewTitle = ""
  private var previewBody = "Start a new conversation with your selected model."
  private var previewMetadata = ""
  private var previewImageURI = ""
  private weak var activePreviewController: HistoryChatPreviewViewController?

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    isUserInteractionEnabled = true
    let tapRecognizer = UITapGestureRecognizer(target: self, action: #selector(handleTap))
    tapRecognizer.cancelsTouchesInView = true
    addGestureRecognizer(tapRecognizer)
    addInteraction(UIContextMenuInteraction(delegate: self))
  }

  public func setPinned(_ value: Bool) {
    pinned = value
  }

  public func setRemoveChatLabel(_ value: String) {
    removeChatLabel = value
  }

  public func setExpirationAction(_ value: String) {
    expirationAction = value
  }

  public func setExpirationPeriodLabel(_ value: String) {
    expirationPeriodLabel = value
  }

  public func setExpiresAt(_ value: Double) {
    expiresAt = value
  }

  public func setPreviewTitle(_ value: String) {
    previewTitle = value
    activePreviewController?.update(title: value)
  }

  public func setPreviewBody(_ value: String) {
    previewBody = value
    activePreviewController?.update(body: value)
  }

  public func setPreviewMetadata(_ value: String) {
    previewMetadata = value
    activePreviewController?.update(metadata: value)
  }

  public func setPreviewImageURI(_ value: String) {
    previewImageURI = value
    activePreviewController?.update(imageURI: value)
  }

  @objc private func handleTap() {
    onChatPress()
  }

  public override func accessibilityActivate() -> Bool {
    onChatPress()
    return true
  }

  public func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configurationForMenuAtLocation location: CGPoint
  ) -> UIContextMenuConfiguration? {
    onPreviewRequest()
    let configuration = UIContextMenuConfiguration(identifier: nil, previewProvider: { [weak self] in
      guard let self else { return nil }
      let controller = HistoryChatPreviewViewController(
        title: previewTitle,
        body: previewBody,
        metadata: previewMetadata,
        imageURI: previewImageURI
      )
      activePreviewController = controller
      return controller
    }) { [weak self] _ in
      guard let self else { return nil }

      let primaryActions = UIMenu(
        title: "",
        options: .displayInline,
        preferredElementSize: .medium,
        children: [
          menuAction(title: "Share", systemImage: "square.and.arrow.up", action: "share"),
          menuAction(title: "Move", systemImage: "folder", action: "move"),
          menuAction(
            title: removeChatLabel,
            systemImage: "trash",
            action: "delete",
            attributes: .destructive
          )
        ]
      )

      var standardActionChildren: [UIMenuElement] = [
        menuAction(
          title: pinned ? "Unpin chat" : "Pin chat",
          systemImage: pinned ? "pin.slash" : "pin",
          action: "pin"
        ),
        menuAction(title: "Rename chat", systemImage: "pencil", action: "rename"),
      ]
      if let expirationMenuAction = expirationMenuAction() {
        standardActionChildren.append(expirationMenuAction)
      }
      standardActionChildren.append(
        menuAction(
          title: "Duplicate chat",
          systemImage: "plus.square.on.square",
          action: "duplicate"
        )
      )

      let standardActions = UIMenu(
        title: "",
        options: .displayInline,
        children: standardActionChildren
      )

      return UIMenu(children: [primaryActions, standardActions])
    }
    configuration.preferredMenuElementOrder = .fixed
    return configuration
  }

  public func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willEndFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    animator?.addCompletion { [weak self] in
      self?.activePreviewController = nil
    }
  }

  private func menuAction(
    title: String,
    systemImage: String,
    action: String,
    imageColor: UIColor? = nil,
    attributes: UIMenuElement.Attributes = []
  ) -> UIAction {
    let image = imageColor.map {
      UIImage(systemName: systemImage)?.withTintColor($0, renderingMode: .alwaysOriginal)
    } ?? UIImage(systemName: systemImage)
    return UIAction(
      title: title,
      image: image,
      attributes: attributes
    ) { [weak self] _ in
      self?.onAction(["action": action])
    }
  }

  private func expirationMenuAction() -> UIAction? {
    if expirationAction == "disable" {
      return menuAction(
        title: "Disable expiry in \(formatExpiryRemaining())",
        systemImage: "hourglass",
        action: "disable-expiration",
        imageColor: .systemTeal
      )
    }
    if expirationAction == "enable", !expirationPeriodLabel.isEmpty {
      return menuAction(
        title: "Expire in \(expirationPeriodLabel)",
        systemImage: "hourglass",
        action: "enable-expiration"
      )
    }
    return nil
  }

  private func formatExpiryRemaining(now: Date = Date()) -> String {
    let remainingMilliseconds = expiresAt - now.timeIntervalSince1970 * 1_000
    if remainingMilliseconds <= 0 {
      return "now"
    }

    let days = Int(floor(remainingMilliseconds / 86_400_000))
    if days > 0 {
      return "\(days)d"
    }

    let hours = Int(floor(remainingMilliseconds / 3_600_000))
    if hours > 0 {
      return "\(hours)h"
    }

    let minutes = max(1, Int(ceil(remainingMilliseconds / 60_000)))
    return "\(minutes)m"
  }
}

private final class HistoryChatPreviewViewController: UIViewController {
  private static let width: CGFloat = 320
  private static let minimumHeight: CGFloat = 176
  private let previewView: HistoryChatPreviewView

  init(title: String, body: String, metadata: String, imageURI: String) {
    let previewView = HistoryChatPreviewView(
      title: title,
      body: body,
      metadata: metadata,
      imageURI: imageURI
    )
    self.previewView = previewView
    super.init(nibName: nil, bundle: nil)

    let fittingSize = previewView.systemLayoutSizeFitting(
      CGSize(width: Self.width, height: UIView.layoutFittingCompressedSize.height),
      withHorizontalFittingPriority: .required,
      verticalFittingPriority: .fittingSizeLevel
    )
    let height = max(Self.minimumHeight, ceil(fittingSize.height))
    previewView.frame = CGRect(x: 0, y: 0, width: Self.width, height: height)
    view = previewView
    preferredContentSize = previewView.bounds.size
  }

  func update(title: String? = nil, body: String? = nil, metadata: String? = nil, imageURI: String? = nil) {
    previewView.update(title: title, body: body, metadata: metadata, imageURI: imageURI)
    let fittingSize = previewView.systemLayoutSizeFitting(
      CGSize(width: Self.width, height: UIView.layoutFittingCompressedSize.height),
      withHorizontalFittingPriority: .required,
      verticalFittingPriority: .fittingSizeLevel
    )
    let height = max(Self.minimumHeight, ceil(fittingSize.height))
    previewView.frame.size = CGSize(width: Self.width, height: height)
    preferredContentSize = previewView.frame.size
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }
}

private final class HistoryChatPreviewView: UIView {
  private static let imageCache = NSCache<NSString, UIImage>()
  private let mark = UIImageView()
  private let titleLabel = UILabel()
  private let bodyLabel = UILabel()
  private let metadataLabel = UILabel()
  private var imageLoadTask: URLSessionDataTask?

  init(title: String, body: String, metadata: String, imageURI: String) {
    super.init(frame: .zero)
    backgroundColor = .secondarySystemBackground
    layer.cornerCurve = .continuous
    layer.cornerRadius = 28
    layer.borderColor = UIColor.opaqueSeparator.cgColor
    layer.borderWidth = 1 / max(traitCollection.displayScale, 1)
    clipsToBounds = true

    mark.backgroundColor = .tertiarySystemFill
    mark.contentMode = .scaleAspectFit
    mark.layer.cornerRadius = 16
    mark.clipsToBounds = true
    mark.translatesAutoresizingMaskIntoConstraints = false

    titleLabel.attributedText = Self.attributedText(
      title,
      font: .systemFont(ofSize: 18, weight: .semibold),
      color: .label,
      kern: -0.35
    )
    titleLabel.lineBreakMode = .byTruncatingTail
    titleLabel.numberOfLines = 1

    let header = UIStackView(arrangedSubviews: [mark, titleLabel])
    header.axis = .horizontal
    header.alignment = .center
    header.spacing = 11

    bodyLabel.attributedText = Self.bodyText(body)
    bodyLabel.lineBreakMode = .byTruncatingTail
    bodyLabel.numberOfLines = 4

    metadataLabel.attributedText = Self.attributedText(
      metadata,
      font: .systemFont(ofSize: 11.5),
      color: Self.mutedColor
    )
    metadataLabel.lineBreakMode = .byTruncatingTail
    metadataLabel.numberOfLines = 1

    let upperSpacer = UIView()
    let lowerSpacer = UIView()
    let content = UIStackView(arrangedSubviews: [header, upperSpacer, bodyLabel, lowerSpacer, metadataLabel])
    content.axis = .vertical
    content.alignment = .fill
    content.spacing = 0
    content.translatesAutoresizingMaskIntoConstraints = false
    addSubview(content)

    NSLayoutConstraint.activate([
      content.topAnchor.constraint(equalTo: topAnchor, constant: 20),
      content.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 20),
      content.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -20),
      content.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -20),
      mark.widthAnchor.constraint(equalToConstant: 32),
      mark.heightAnchor.constraint(equalToConstant: 32),
      upperSpacer.heightAnchor.constraint(greaterThanOrEqualToConstant: 18),
      lowerSpacer.heightAnchor.constraint(greaterThanOrEqualToConstant: 16),
      upperSpacer.heightAnchor.constraint(equalTo: lowerSpacer.heightAnchor, constant: 2),
    ])
    setImage(uri: imageURI)
  }

  deinit {
    imageLoadTask?.cancel()
  }

  func update(title: String?, body: String?, metadata: String?, imageURI: String?) {
    if let title {
      titleLabel.attributedText = Self.attributedText(
        title,
        font: .systemFont(ofSize: 18, weight: .semibold),
        color: .label,
        kern: -0.35
      )
    }
    if let body { bodyLabel.attributedText = Self.bodyText(body) }
    if let metadata {
      metadataLabel.attributedText = Self.attributedText(
        metadata,
        font: .systemFont(ofSize: 11.5),
        color: Self.mutedColor
      )
    }
    if let imageURI { setImage(uri: imageURI) }
    setNeedsLayout()
  }

  private func setImage(uri: String) {
    imageLoadTask?.cancel()
    imageLoadTask = nil
    mark.image = Self.image(for: uri)
    guard mark.image == nil,
          let url = URL(string: uri),
          let scheme = url.scheme?.lowercased(),
          scheme == "http" || scheme == "https" else { return }
    imageLoadTask = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
      guard let data, let image = UIImage(data: data) else { return }
      Self.imageCache.setObject(image, forKey: uri as NSString)
      DispatchQueue.main.async { self?.mark.image = image }
    }
    imageLoadTask?.resume()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  private static var mutedColor: UIColor {
    UIColor { traits in
      if traits.userInterfaceStyle == .dark {
        return UIColor(red: 161 / 255, green: 161 / 255, blue: 168 / 255, alpha: 1)
      }
      return UIColor(red: 104 / 255, green: 104 / 255, blue: 111 / 255, alpha: 1)
    }
  }

  private static func attributedText(
    _ text: String,
    font: UIFont,
    color: UIColor,
    kern: CGFloat? = nil
  ) -> NSAttributedString {
    var attributes: [NSAttributedString.Key: Any] = [
      .font: font,
      .foregroundColor: color,
    ]
    if let kern {
      attributes[.kern] = kern
    }
    return NSAttributedString(string: text, attributes: attributes)
  }

  private static func bodyText(_ text: String) -> NSAttributedString {
    let paragraph = NSMutableParagraphStyle()
    paragraph.minimumLineHeight = 20
    paragraph.maximumLineHeight = 20
    paragraph.lineBreakMode = .byTruncatingTail
    return NSAttributedString(
      string: text,
      attributes: [
        .font: UIFont.systemFont(ofSize: 14.5),
        .foregroundColor: UIColor.label,
        .paragraphStyle: paragraph,
      ]
    )
  }

  private static func image(for uri: String) -> UIImage? {
    guard !uri.isEmpty else { return nil }
    if let cached = imageCache.object(forKey: uri as NSString) {
      return cached
    }

    let image: UIImage?
    if let url = URL(string: uri), url.isFileURL {
      image = UIImage(contentsOfFile: url.path)
    } else if uri.hasPrefix("/") {
      image = UIImage(contentsOfFile: uri)
    } else {
      image = UIImage(named: uri)
    }
    if let image {
      imageCache.setObject(image, forKey: uri as NSString)
    }
    return image
  }
}
