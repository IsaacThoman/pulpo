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
  private var previewModelName = ""
  private var previewModelImageURI = ""
  private var previewBody = "Start a new conversation with your selected model."
  private var previewMetadata = ""
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

  public func setPreviewModelName(_ value: String) {
    previewModelName = value
    activePreviewController?.update(modelName: value)
  }

  public func setPreviewModelImageURI(_ value: String) {
    previewModelImageURI = value
    activePreviewController?.update(modelImageURI: value)
  }

  public func setPreviewBody(_ value: String) {
    previewBody = value
    activePreviewController?.update(body: value)
  }

  public func setPreviewMetadata(_ value: String) {
    previewMetadata = value
    activePreviewController?.update(metadata: value)
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
        modelName: previewModelName,
        modelImageURI: previewModelImageURI,
        body: previewBody,
        metadata: previewMetadata
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
    willPerformPreviewActionForMenuWith configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionCommitAnimating
  ) {
    animator.addCompletion { [weak self] in
      self?.onChatPress()
    }
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

  init(title: String, modelName: String, modelImageURI: String, body: String, metadata: String) {
    let previewView = HistoryChatPreviewView(
      title: title,
      modelName: modelName,
      modelImageURI: modelImageURI,
      body: body,
      metadata: metadata
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

  func update(title: String? = nil, modelName: String? = nil, modelImageURI: String? = nil, body: String? = nil, metadata: String? = nil) {
    previewView.update(title: title, modelName: modelName, modelImageURI: modelImageURI, body: body, metadata: metadata)
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
  private let titleLabel = UILabel()
  private let modelImageView = UIImageView()
  private let modelNameLabel = UILabel()
  private let bodyLabel = UILabel()
  private let metadataLabel = UILabel()
  private var imageLoadTask: URLSessionDataTask?

  init(title: String, modelName: String, modelImageURI: String, body: String, metadata: String) {
    super.init(frame: .zero)
    backgroundColor = .secondarySystemBackground
    layer.cornerCurve = .continuous
    layer.cornerRadius = 28
    layer.borderColor = UIColor.opaqueSeparator.cgColor
    layer.borderWidth = 1 / max(traitCollection.displayScale, 1)
    clipsToBounds = true

    titleLabel.attributedText = Self.attributedText(
      title,
      font: .systemFont(ofSize: 18, weight: .semibold),
      color: .label,
      kern: -0.35
    )
    titleLabel.lineBreakMode = .byTruncatingTail
    titleLabel.numberOfLines = 1

    modelNameLabel.attributedText = Self.attributedText(
      modelName,
      font: .systemFont(ofSize: 14, weight: .semibold),
      color: .label,
      kern: -0.1
    )
    modelNameLabel.lineBreakMode = .byTruncatingTail
    modelNameLabel.numberOfLines = 1

    modelImageView.contentMode = .scaleAspectFit
    modelImageView.translatesAutoresizingMaskIntoConstraints = false

    let modelIdentity = UIStackView(arrangedSubviews: [modelImageView, modelNameLabel])
    modelIdentity.axis = .horizontal
    modelIdentity.alignment = .center
    modelIdentity.spacing = 7

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

    let titleSpacer = UIView()
    let bodySpacer = UIView()
    let lowerSpacer = UIView()
    let content = UIStackView(arrangedSubviews: [
      titleLabel,
      titleSpacer,
      modelIdentity,
      bodySpacer,
      bodyLabel,
      lowerSpacer,
      metadataLabel,
    ])
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
      modelImageView.widthAnchor.constraint(equalToConstant: 18),
      modelImageView.heightAnchor.constraint(equalToConstant: 18),
      titleSpacer.heightAnchor.constraint(equalToConstant: 14),
      bodySpacer.heightAnchor.constraint(equalToConstant: 6),
      lowerSpacer.heightAnchor.constraint(greaterThanOrEqualToConstant: 16),
    ])
    setModelImage(uri: modelImageURI)
  }

  deinit {
    imageLoadTask?.cancel()
  }

  func update(title: String?, modelName: String?, modelImageURI: String?, body: String?, metadata: String?) {
    if let title {
      titleLabel.attributedText = Self.attributedText(
        title,
        font: .systemFont(ofSize: 18, weight: .semibold),
        color: .label,
        kern: -0.35
      )
    }
    if let modelName {
      modelNameLabel.attributedText = Self.attributedText(
        modelName,
        font: .systemFont(ofSize: 14, weight: .semibold),
        color: .label,
        kern: -0.1
      )
    }
    if let modelImageURI { setModelImage(uri: modelImageURI) }
    if let body { bodyLabel.attributedText = Self.bodyText(body) }
    if let metadata {
      metadataLabel.attributedText = Self.attributedText(
        metadata,
        font: .systemFont(ofSize: 11.5),
        color: Self.mutedColor
      )
    }
    setNeedsLayout()
  }

  private func setModelImage(uri: String) {
    imageLoadTask?.cancel()
    imageLoadTask = nil
    modelImageView.image = Self.image(for: uri)
    guard modelImageView.image == nil,
          let url = URL(string: uri),
          let scheme = url.scheme?.lowercased(),
          scheme == "http" || scheme == "https" else { return }
    imageLoadTask = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
      guard let data, let image = UIImage(data: data) else { return }
      Self.imageCache.setObject(image, forKey: uri as NSString)
      DispatchQueue.main.async { self?.modelImageView.image = image }
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
    let maximumCharacters = 2_000
    let limited = text.count > maximumCharacters
      ? String(text.prefix(maximumCharacters - 1)) + "…"
      : text
    let normalized = limited.components(separatedBy: .newlines).map { line in
      if line.hasPrefix("- ") || line.hasPrefix("* ") {
        return "• " + String(line.dropFirst(2))
      }
      return line
    }.joined(separator: "\n")

    let baseFont = UIFont.systemFont(ofSize: 14.5)
    let result = NSMutableAttributedString(
      string: normalized,
      attributes: [
        .font: baseFont,
        .foregroundColor: UIColor.label,
      ]
    )
    applyLinks(to: result)
    applyMarkdown(
      pattern: "(\\*\\*|__)(.+?)\\1",
      capture: 2,
      attributes: [.font: UIFont.systemFont(ofSize: 14.5, weight: .semibold)],
      to: result
    )
    let italicDescriptor = baseFont.fontDescriptor.withSymbolicTraits(.traitItalic) ?? baseFont.fontDescriptor
    let italicFont = UIFont(descriptor: italicDescriptor, size: 14.5)
    applyMarkdown(
      pattern: "(?<!\\*)\\*([^*\\n]+)\\*(?!\\*)",
      capture: 1,
      attributes: [.font: italicFont],
      to: result
    )
    applyMarkdown(
      pattern: "(?<!_)_([^_\\n]+)_(?!_)",
      capture: 1,
      attributes: [.font: italicFont],
      to: result
    )
    applyMarkdown(
      pattern: "`([^`\\n]+)`",
      capture: 1,
      attributes: [
        .font: UIFont.monospacedSystemFont(ofSize: 13.5, weight: .regular),
        .backgroundColor: UIColor.tertiarySystemFill,
      ],
      to: result
    )

    let paragraph = NSMutableParagraphStyle()
    paragraph.minimumLineHeight = 20
    paragraph.maximumLineHeight = 20
    paragraph.lineBreakMode = .byTruncatingTail
    result.addAttribute(.paragraphStyle, value: paragraph, range: NSRange(location: 0, length: result.length))
    return result
  }

  private static func applyMarkdown(
    pattern: String,
    capture: Int,
    attributes: [NSAttributedString.Key: Any],
    to text: NSMutableAttributedString
  ) {
    guard let expression = try? NSRegularExpression(pattern: pattern) else { return }
    let range = NSRange(location: 0, length: text.length)
    for match in expression.matches(in: text.string, range: range).reversed() {
      let contentRange = match.range(at: capture)
      guard contentRange.location != NSNotFound else { continue }
      let content = text.attributedSubstring(from: contentRange)
      text.replaceCharacters(in: match.range, with: content)
      text.addAttributes(
        attributes,
        range: NSRange(location: match.range.location, length: content.length)
      )
    }
  }

  private static func applyLinks(to text: NSMutableAttributedString) {
    guard let expression = try? NSRegularExpression(
      pattern: "\\[([^\\]\\n]+)\\]\\((https?://[^\\s)]+)\\)"
    ) else { return }
    let range = NSRange(location: 0, length: text.length)
    for match in expression.matches(in: text.string, range: range).reversed() {
      let labelRange = match.range(at: 1)
      let urlRange = match.range(at: 2)
      guard labelRange.location != NSNotFound,
            urlRange.location != NSNotFound,
            let url = URL(string: (text.string as NSString).substring(with: urlRange)) else { continue }
      let label = text.attributedSubstring(from: labelRange)
      text.replaceCharacters(in: match.range, with: label)
      text.addAttributes(
        [.link: url, .foregroundColor: UIColor.systemBlue, .underlineStyle: NSUnderlineStyle.single.rawValue],
        range: NSRange(location: match.range.location, length: label.length)
      )
    }
  }

  private static func image(for uri: String) -> UIImage? {
    guard !uri.isEmpty else { return nil }
    if let cached = imageCache.object(forKey: uri as NSString) { return cached }
    let image: UIImage?
    if let url = URL(string: uri), url.isFileURL {
      image = UIImage(contentsOfFile: url.path)
    } else if uri.hasPrefix("/") {
      image = UIImage(contentsOfFile: uri)
    } else {
      image = UIImage(named: uri)
    }
    if let image { imageCache.setObject(image, forKey: uri as NSString) }
    return image
  }
}
