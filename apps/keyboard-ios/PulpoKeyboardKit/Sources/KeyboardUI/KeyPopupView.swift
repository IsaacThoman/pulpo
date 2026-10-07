#if os(iOS)
import UIKit

/// The balloon that rises out of a pressed key, and the long-press accent strip.
final class KeyPopupView: UIView {
  private let shape = CAShapeLayer()
  private var labels: [UILabel] = []
  private let selection = CALayer()
  private(set) var options: [String] = []
  private(set) var selectedIndex = 0
  private var bubble: CGRect = .zero
  private var cellWidth: CGFloat = 0
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
    configure(options: [text], keyRect: keyRect, in: bounds, style: style, cell: keyRect.width + 20, preferredIndex: 0)
    selection.isHidden = true
  }

  /// Shows alternates and selects the one nearest the finger.
  func showAlternates(_ options: [String], keyRect: CGRect, in bounds: CGRect, style: KeyboardStyle) {
    configure(options: options, keyRect: keyRect, in: bounds, style: style, cell: max(keyRect.width, 30), preferredIndex: 0)
    selection.isHidden = false
    select(0)
  }

  private func configure(options: [String], keyRect: CGRect, in bounds: CGRect, style: KeyboardStyle, cell: CGFloat, preferredIndex: Int) {
    self.style = style
    self.options = options
    cellWidth = cell
    frame = bounds
    let available = keyRect.minY - 1
    let neck = min(11, max(4, available * 0.2))
    let height = min(keyRect.height + 12, available - neck)
    let width = cell * CGFloat(options.count) + (options.count > 1 ? 8 : 0)
    var x = options.count > 1 ? keyRect.minX - 4 : keyRect.midX - width / 2
    if x + width > bounds.maxX - 2 { x = options.count > 1 ? keyRect.maxX + 4 - width : bounds.maxX - 2 - width }
    x = max(bounds.minX + 2, x)
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
    labels.forEach { $0.removeFromSuperview() }
    labels = options.enumerated().map { index, text in
      let label = UILabel()
      label.text = text
      label.textAlignment = .center
      label.textColor = style.label
      // Top-row balloons have less headroom; the letter shrinks to fit rather than clip.
      label.font = options.count > 1 ? .systemFont(ofSize: min(26, height * 0.7)) : style.popupFont.withSize(min(style.popupFont.pointSize, height * 0.8))
      label.adjustsFontSizeToFitWidth = true
      label.minimumScaleFactor = 0.5
      let cellX = options.count > 1 ? bubble.minX + 4 + CGFloat(index) * cell : bubble.minX
      label.frame = CGRect(x: cellX, y: bubble.minY, width: options.count > 1 ? cell : bubble.width, height: bubble.height)
      addSubview(label)
      return label
    }
    selection.backgroundColor = style.accent.cgColor
    selection.cornerRadius = style.cornerRadius
    CATransaction.commit()
    isHidden = false
  }

  /// Picks the alternate under `x` (superview coordinates).
  func track(x: CGFloat) {
    guard options.count > 1 else { return }
    let index = Int(((x - bubble.minX - 4) / cellWidth).rounded(.down))
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
  }

  var selectedOption: String? { options.indices.contains(selectedIndex) ? options[selectedIndex] : nil }

  func hide() {
    isHidden = true
    options = []
  }
}
#endif
