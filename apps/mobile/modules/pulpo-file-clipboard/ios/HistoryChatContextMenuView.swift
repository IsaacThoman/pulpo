import ExpoModulesCore
import UIKit

public final class HistoryChatContextMenuView: ExpoView, UIContextMenuInteractionDelegate {
  let onAction = EventDispatcher()
  let onPress = EventDispatcher()

  private var pinned = false
  private var removeChatLabel = "Delete chat"
  private var previewTitle = ""
  private var previewBody = "Start a new conversation with your selected model."
  private var previewMetadata = ""
  private var previewImageURI = ""

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

  public func setPreviewTitle(_ value: String) {
    previewTitle = value
  }

  public func setPreviewBody(_ value: String) {
    previewBody = value
  }

  public func setPreviewMetadata(_ value: String) {
    previewMetadata = value
  }

  public func setPreviewImageURI(_ value: String) {
    previewImageURI = value
  }

  @objc private func handleTap() {
    onPress()
  }

  public override func accessibilityActivate() -> Bool {
    onPress()
    return true
  }

  public func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configurationForMenuAtLocation location: CGPoint
  ) -> UIContextMenuConfiguration? {
    let configuration = UIContextMenuConfiguration(identifier: nil, previewProvider: { [weak self] in
      guard let self else { return nil }
      return HistoryChatPreviewViewController(
        title: previewTitle,
        body: previewBody,
        metadata: previewMetadata,
        imageURI: previewImageURI
      )
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

      let standardActions = UIMenu(
        title: "",
        options: .displayInline,
        children: [
          menuAction(
            title: pinned ? "Unpin chat" : "Pin chat",
            systemImage: pinned ? "pin.slash" : "pin",
            action: "pin"
          ),
          menuAction(title: "Rename chat", systemImage: "pencil", action: "rename"),
          menuAction(
            title: "Duplicate chat",
            systemImage: "plus.square.on.square",
            action: "duplicate"
          )
        ]
      )

      return UIMenu(children: [primaryActions, standardActions])
    }
    configuration.preferredMenuElementOrder = .fixed
    return configuration
  }

  private func menuAction(
    title: String,
    systemImage: String,
    action: String,
    attributes: UIMenuElement.Attributes = []
  ) -> UIAction {
    UIAction(
      title: title,
      image: UIImage(systemName: systemImage),
      attributes: attributes
    ) { [weak self] _ in
      self?.onAction(["action": action])
    }
  }
}

private final class HistoryChatPreviewViewController: UIViewController {
  private static let width: CGFloat = 320
  private static let minimumHeight: CGFloat = 176

  init(title: String, body: String, metadata: String, imageURI: String) {
    super.init(nibName: nil, bundle: nil)

    let previewView = HistoryChatPreviewView(
      title: title,
      body: body,
      metadata: metadata,
      imageURI: imageURI
    )
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

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }
}

private final class HistoryChatPreviewView: UIView {
  private static let imageCache = NSCache<NSString, UIImage>()

  init(title: String, body: String, metadata: String, imageURI: String) {
    super.init(frame: .zero)
    backgroundColor = .secondarySystemBackground
    layer.cornerCurve = .continuous
    layer.cornerRadius = 28
    layer.borderColor = UIColor.opaqueSeparator.cgColor
    layer.borderWidth = 1 / max(traitCollection.displayScale, 1)
    clipsToBounds = true

    let mark = UIImageView(image: Self.image(for: imageURI))
    mark.backgroundColor = UIColor.systemYellow.withAlphaComponent(0.28)
    mark.contentMode = .scaleAspectFill
    mark.layer.cornerRadius = 16
    mark.clipsToBounds = true
    mark.translatesAutoresizingMaskIntoConstraints = false

    let eyebrow = UILabel()
    eyebrow.attributedText = Self.attributedText(
      "PULPO CHAT",
      font: .systemFont(ofSize: 10.5, weight: .semibold),
      color: Self.mutedColor,
      kern: 0.8
    )

    let titleLabel = UILabel()
    titleLabel.attributedText = Self.attributedText(
      title,
      font: .systemFont(ofSize: 18, weight: .semibold),
      color: .label,
      kern: -0.35
    )
    titleLabel.lineBreakMode = .byTruncatingTail
    titleLabel.numberOfLines = 1

    let titleStack = UIStackView(arrangedSubviews: [eyebrow, titleLabel])
    titleStack.axis = .vertical
    titleStack.alignment = .fill
    titleStack.spacing = 2

    let header = UIStackView(arrangedSubviews: [mark, titleStack])
    header.axis = .horizontal
    header.alignment = .center
    header.spacing = 11

    let bodyLabel = UILabel()
    bodyLabel.attributedText = Self.bodyText(body)
    bodyLabel.lineBreakMode = .byTruncatingTail
    bodyLabel.numberOfLines = 4

    let metadataLabel = UILabel()
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
