#if os(iOS)
import UIKit

/// The balloon that rises out of a pressed key, and the long-press accent strip.
final class KeyPopupView: UIView {
  private let shape = CAShapeLayer()
  private var labels: [UILabel] = []
  private var labelPool: [UILabel] = []
  /// Menu cells drawn as symbols instead of text.
  private var symbolViews: [UIImageView] = []
  private let selection = CALayer()
  private(set) var options: [String] = []
  private(set) var selectedIndex = 0
  private var bubble: CGRect = .zero
  private var cellWidth: CGFloat = 0
  /// The displayed index of the default option, above the key.
  private(set) var baseIndex = 0
  private var anchorX: CGFloat = 0
  private var style: KeyboardStyle

  init(style: KeyboardStyle) {
    self.style = style
    super.init(frame: .zero)
    isUserInteractionEnabled = false
    shape.shadowColor = UIColor.black.cgColor
    shape.shadowOpacity = style.dark ? 0.5 : 0.22
    shape.shadowRadius = style.modern ? 6 : 1.5
    shape.shadowOffset = CGSize(width: 0, height: style.modern ? 2 : 1)
    layer.addSublayer(shape)
    selection.cornerCurve = .continuous
    layer.addSublayer(selection)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  /// Shows a single character above `keyRect` (in this view's superview coordinates).
  func showPreview(_ text: String, keyRect: CGRect, in bounds: CGRect, style: KeyboardStyle) {
    configure(options: [text], keyRect: keyRect, in: bounds, style: style, cell: keyRect.width + 20, rightward: nil)
    selection.isHidden = true
  }

  /// Shows alternates with the first option selected. The strip opens away from
  /// the nearer screen edge; when it opens leftward the order is mirrored, as on
  /// the system keyboard and Gboard, so the first option sits above the key.
  /// Selection then follows the finger relative to `anchorX` (default: the key's
  /// center), so a long press released in place types the first option.
  /// `emoji` options are drawn with `EmojiFont`.
  func showAlternates(_ options: [String], keyRect: CGRect, in bounds: CGRect, style: KeyboardStyle, anchorX: CGFloat? = nil, emoji: Bool = false) {
    let layout = Self.stripLayout(keyRect: keyRect, in: bounds, count: options.count)
    let display = layout.rightward ? options : options.reversed()
    configure(options: display, keyRect: keyRect, in: bounds, style: style, cell: layout.cell, rightward: display.count > 1 ? layout.rightward : nil, emoji: emoji)
    baseIndex = layout.rightward ? 0 : max(display.count - 1, 0)
    self.anchorX = anchorX ?? keyRect.midX
    selection.isHidden = false
    select(baseIndex)
  }

  /// A menu of symbols above `keyRect` with `selected` highlighted and centered
  /// over the key where the screen allows. `options` name the choices; the
  /// finger moves the selection one cell at a time from `anchorX`.
  func showMenu(_ options: [String], symbols: [String], selected: Int, keyRect: CGRect, in bounds: CGRect, style: KeyboardStyle, anchorX: CGFloat? = nil) {
    let cell = max(keyRect.width, 44)
    let index = min(max(selected, 0), max(options.count - 1, 0))
    let x = keyRect.midX - 4 - cell * (CGFloat(index) + 0.5)
    configure(options: options, keyRect: keyRect, in: bounds, style: style, cell: cell, rightward: true, preferredX: x, symbols: symbols)
    baseIndex = index
    self.anchorX = anchorX ?? keyRect.midX
    selection.isHidden = false
    select(index)
  }

  /// Which way a strip opens and how wide its cells are. Cells match the key
  /// unless that would leave the screen; wide keys such as .com then narrow
  /// their cells to fit on the roomier side, keeping the first option over the key.
  static func stripLayout(keyRect: CGRect, in bounds: CGRect, count: Int) -> (rightward: Bool, cell: CGFloat) {
    let natural = max(keyRect.width, 30)
    let count = CGFloat(max(count, 1))
    let rightRoom = bounds.maxX - 2 - (keyRect.minX - 4) - 8
    let leftRoom = keyRect.maxX + 4 - (bounds.minX + 2) - 8
    if natural * count <= rightRoom { return (true, natural) }
    if natural * count <= leftRoom { return (false, natural) }
    let rightward = rightRoom >= leftRoom
    return (rightward, max(30, (rightward ? rightRoom : leftRoom) / count))
  }

  /// `rightward` is nil for a single centered balloon.
  private func configure(options: [String], keyRect: CGRect, in bounds: CGRect, style: KeyboardStyle, cell: CGFloat, rightward: Bool?,
                         preferredX: CGFloat? = nil, symbols: [String]? = nil, emoji: Bool = false) {
    self.style = style
    self.options = options
    cellWidth = cell
    frame = bounds
    let available = keyRect.minY - 1
    let neck = min(11, max(4, available * 0.2))
    let height = min(keyRect.height + 12, available - neck)
    let width = cell * CGFloat(options.count) + (options.count > 1 ? 8 : 0)
    var x: CGFloat
    switch rightward {
    case true?: x = preferredX ?? keyRect.minX - 4
    case false?: x = keyRect.maxX + 4 - width
    case nil: x = keyRect.midX - width / 2
    }
    x = max(bounds.minX + 2, min(x, bounds.maxX - 2 - width))
    bubble = CGRect(x: x, y: keyRect.minY - neck - height, width: width, height: height)

    let radius = style.cornerRadius + 2
    let keyRadius = style.cornerRadius
    let path = UIBezierPath()
    path.move(to: CGPoint(x: keyRect.minX, y: keyRect.maxY - keyRadius))
    path.addLine(to: CGPoint(x: keyRect.minX, y: keyRect.minY))
    path.addCurve(to: CGPoint(x: bubble.minX, y: bubble.maxY - radius),
                  controlPoint1: CGPoint(x: keyRect.minX, y: keyRect.minY - neck * 0.6),
                  controlPoint2: CGPoint(x: bubble.minX, y: bubble.maxY - radius + neck * 0.2))
    path.addLine(to: CGPoint(x: bubble.minX, y: bubble.minY + radius))
    path.addQuadCurve(to: CGPoint(x: bubble.minX + radius, y: bubble.minY), controlPoint: CGPoint(x: bubble.minX, y: bubble.minY))
    path.addLine(to: CGPoint(x: bubble.maxX - radius, y: bubble.minY))
    path.addQuadCurve(to: CGPoint(x: bubble.maxX, y: bubble.minY + radius), controlPoint: CGPoint(x: bubble.maxX, y: bubble.minY))
    path.addLine(to: CGPoint(x: bubble.maxX, y: bubble.maxY - radius))
    path.addCurve(to: CGPoint(x: keyRect.maxX, y: keyRect.minY),
                  controlPoint1: CGPoint(x: bubble.maxX, y: bubble.maxY - radius + neck * 0.2),
                  controlPoint2: CGPoint(x: keyRect.maxX, y: keyRect.minY - neck * 0.6))
    path.addLine(to: CGPoint(x: keyRect.maxX, y: keyRect.maxY - keyRadius))
    path.addQuadCurve(to: CGPoint(x: keyRect.maxX - keyRadius, y: keyRect.maxY), controlPoint: CGPoint(x: keyRect.maxX, y: keyRect.maxY))
    path.addLine(to: CGPoint(x: keyRect.minX + keyRadius, y: keyRect.maxY))
    path.addQuadCurve(to: CGPoint(x: keyRect.minX, y: keyRect.maxY - keyRadius), controlPoint: CGPoint(x: keyRect.minX, y: keyRect.maxY))
    path.close()

    CATransaction.begin()
    CATransaction.setDisableActions(true)
    shape.path = path.cgPath
    shape.fillColor = style.popup.cgColor
    shape.shadowOpacity = style.dark ? 0.5 : 0.22
    // Every key press shows a balloon; reuse its labels rather than building new ones.
    labels.forEach { $0.isHidden = true }
    labels = options.enumerated().map { index, text in
      let label: UILabel
      if index < labelPool.count {
        label = labelPool[index]
      } else {
        label = UILabel()
        labelPool.append(label)
        addSubview(label)
      }
      label.isHidden = false
      label.text = text
      label.textAlignment = .center
      label.textColor = style.label
      // Top-row balloons have less headroom; the letter shrinks to fit rather than clip.
      if emoji {
        label.font = EmojiFont.ofSize(min(26, height * 0.7))
      } else {
        label.font = options.count > 1 ? .systemFont(ofSize: min(26, height * 0.7)) : style.popupFont.withSize(min(style.popupFont.pointSize, height * 0.8))
      }
      label.adjustsFontSizeToFitWidth = true
      label.minimumScaleFactor = 0.5
      let cellX = options.count > 1 ? bubble.minX + 4 + CGFloat(index) * cell : bubble.minX
      label.frame = CGRect(x: cellX, y: bubble.minY, width: options.count > 1 ? cell : bubble.width, height: bubble.height)
        .insetBy(dx: options.count > 1 ? 2 : 0, dy: 0)
      return label
    }
    symbolViews.forEach { $0.removeFromSuperview() }
    symbolViews = (symbols ?? []).enumerated().map { index, name in
      labels[index].text = nil
      let view = UIImageView(image: UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(pointSize: min(24, height * 0.5), weight: .regular)))
      view.contentMode = .center
      view.tintColor = style.label
      view.frame = labels[index].frame
      addSubview(view)
      return view
    }
    selection.backgroundColor = style.accent.cgColor
    selection.cornerRadius = style.cornerRadius
    CATransaction.commit()
    isHidden = false
  }

  /// Picks an alternate by how far the finger has moved from where the strip
  /// opened (superview coordinates): one cell per option.
  func track(x: CGFloat) {
    guard options.count > 1, cellWidth > 0 else { return }
    let steps = ((x - anchorX) / cellWidth).rounded()
    guard steps.isFinite else { return }
    let index = baseIndex + Int(max(-100, min(100, steps)))
    select(min(max(index, 0), options.count - 1))
  }

  private func select(_ index: Int) {
    selectedIndex = index
    guard options.count > 1 else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    selection.frame = CGRect(x: bubble.minX + 4 + CGFloat(index) * cellWidth, y: bubble.minY + 5, width: cellWidth, height: bubble.height - 10)
    CATransaction.commit()
    for (offset, label) in labels.enumerated() { label.textColor = offset == index ? .white : style.label }
    for (offset, view) in symbolViews.enumerated() { view.tintColor = offset == index ? .white : style.label }
  }

  var selectedOption: String? { options.indices.contains(selectedIndex) ? options[selectedIndex] : nil }

  /// The balloon or strip, in this view's superview coordinates.
  var bubbleFrame: CGRect { bubble }

  func hide() {
    isHidden = true
    options = []
  }
}
#endif
