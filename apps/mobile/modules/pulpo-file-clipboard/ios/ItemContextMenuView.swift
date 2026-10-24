import ExpoModulesCore
import UIKit

/** One action of a context menu; actions with `children` become submenus. Sections are separated inline. */
struct ItemContextMenuAction: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var systemImage: String = ""
  @Field var section: Int = 0
  @Field var destructive: Bool = false
  @Field var disabled: Bool = false
  @Field var checked: Bool = false
  @Field var parent: String = ""
}

struct ItemContextMenuPreview: Record {
  @Field var title: String = ""
  @Field var subtitle: String = ""
  @Field var systemImage: String = ""
  @Field var tint: String = ""
  /** A local image file to show instead of the symbol (e.g. a downloaded photo). */
  @Field var imageURI: String = ""
}

/**
 * Wraps a React Native row with a native long-press menu and preview, driven entirely by props: Files
 * items, scope chips, and other lists describe their actions as data. Taps are reported as `onItemPress` (`onPress` is React Native's own event name).
 */
public final class ItemContextMenuView: ExpoView, UIContextMenuInteractionDelegate {
  let onAction = EventDispatcher()
  let onItemPress = EventDispatcher()

  private var actions: [ItemContextMenuAction] = []
  private var preview = ItemContextMenuPreview()
  private var pendingAction: String?
  private var pressEnabled = true

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    isUserInteractionEnabled = true
    let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap))
    tap.cancelsTouchesInView = true
    addGestureRecognizer(tap)
    addInteraction(UIContextMenuInteraction(delegate: self))
  }

  func setActions(_ value: [ItemContextMenuAction]) {
    actions = value
  }

  func setPreview(_ value: ItemContextMenuPreview) {
    preview = value
  }

  func setPressEnabled(_ value: Bool) {
    pressEnabled = value
  }

  @objc private func handleTap() {
    if pressEnabled { onItemPress() }
  }

  public override func accessibilityActivate() -> Bool {
    guard pressEnabled else { return false }
    onItemPress()
    return true
  }

  public override var accessibilityCustomActions: [UIAccessibilityCustomAction]? {
    get {
      actions.filter { action in !action.disabled && action.parent.isEmpty && !actions.contains(where: { child in child.parent == action.id }) }.map { action in
        UIAccessibilityCustomAction(name: action.title) { [weak self] _ in
          self?.onAction(["id": action.id])
          return true
        }
      }
    }
    set {}
  }

  public func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configurationForMenuAtLocation location: CGPoint
  ) -> UIContextMenuConfiguration? {
    guard !actions.isEmpty else { return nil }
    let preview = self.preview
    let configuration = UIContextMenuConfiguration(identifier: nil, previewProvider: preview.title.isEmpty ? nil : {
      ItemPreviewViewController(preview: preview)
    }) { [weak self] _ in
      self?.menu()
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
      guard let self, self.pressEnabled else { return }
      self.onItemPress()
    }
  }

  public func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willEndFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    // UIKit inserts preview views beside the React-managed row; act once it restored the hierarchy.
    let finish = { [weak self] in
      guard let self, let action = self.pendingAction else { return }
      self.pendingAction = nil
      self.onAction(["id": action])
    }
    if let animator { animator.addCompletion(finish) }
    else { DispatchQueue.main.async(execute: finish) }
  }

  private func element(_ action: ItemContextMenuAction) -> UIMenuElement {
    let image = action.systemImage.isEmpty ? nil : UIImage(systemName: action.systemImage)
    let children = actions.filter { $0.parent == action.id }
    if !children.isEmpty {
      return UIMenu(title: action.title, image: image, children: children.map(element))
    }
    var attributes: UIMenuElement.Attributes = []
    if action.destructive { attributes.insert(.destructive) }
    if action.disabled { attributes.insert(.disabled) }
    return UIAction(title: action.title, image: image, attributes: attributes, state: action.checked ? .on : .off) { [weak self] _ in
      self?.pendingAction = action.id
    }
  }

  private func menu() -> UIMenu {
    let topLevel = actions.filter { $0.parent.isEmpty }
    let sections = Dictionary(grouping: topLevel, by: \.section).sorted { $0.key < $1.key }
    return UIMenu(children: sections.map { _, items in
      UIMenu(title: "", options: .displayInline, children: items.map(element))
    })
  }
}

private final class ItemPreviewViewController: UIViewController {
  private let preview: ItemContextMenuPreview

  init(preview: ItemContextMenuPreview) {
    self.preview = preview
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { nil }

  override func loadView() {
    let container = UIView()
    container.backgroundColor = .secondarySystemBackground
    if !preview.imageURI.isEmpty, let url = URL(string: preview.imageURI), url.isFileURL,
       let image = UIImage(contentsOfFile: url.path) {
      let imageView = UIImageView(image: image)
      imageView.contentMode = .scaleAspectFill
      imageView.clipsToBounds = true
      imageView.translatesAutoresizingMaskIntoConstraints = false
      container.addSubview(imageView)
      NSLayoutConstraint.activate([
        imageView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
        imageView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
        imageView.topAnchor.constraint(equalTo: container.topAnchor),
        imageView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
      ])
      let size = image.size
      let width: CGFloat = 300
      preferredContentSize = CGSize(width: width, height: min(420, max(160, width * size.height / max(size.width, 1))))
      view = container
      return
    }
    let icon = UIImageView(image: UIImage(systemName: preview.systemImage.isEmpty ? "doc" : preview.systemImage))
    icon.tintColor = UIColor(itemHex: preview.tint) ?? .systemBlue
    icon.contentMode = .scaleAspectFit
    icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 44, weight: .regular)
    let title = UILabel()
    title.text = preview.title
    title.font = .preferredFont(forTextStyle: .headline)
    title.numberOfLines = 2
    title.textAlignment = .center
    let subtitle = UILabel()
    subtitle.text = preview.subtitle
    subtitle.font = .preferredFont(forTextStyle: .subheadline)
    subtitle.textColor = .secondaryLabel
    subtitle.numberOfLines = 2
    subtitle.textAlignment = .center
    let stack = UIStackView(arrangedSubviews: [icon, title, subtitle])
    stack.axis = .vertical
    stack.alignment = .center
    stack.spacing = 10
    stack.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.centerYAnchor.constraint(equalTo: container.centerYAnchor),
      stack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 20),
      stack.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -20),
      icon.heightAnchor.constraint(equalToConstant: 56),
    ])
    preferredContentSize = CGSize(width: 280, height: 190)
    view = container
  }
}

extension UIColor {
  convenience init?(itemHex value: String) {
    var hex = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if hex.hasPrefix("#") { hex.removeFirst() }
    guard hex.count == 6, let number = UInt64(hex, radix: 16) else { return nil }
    self.init(red: CGFloat((number >> 16) & 0xff) / 255, green: CGFloat((number >> 8) & 0xff) / 255, blue: CGFloat(number & 0xff) / 255, alpha: 1)
  }
}
