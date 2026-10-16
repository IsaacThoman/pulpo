#if os(iOS)
import UIKit

/// The strip beside a docked one-handed keyboard: expand back to full width,
/// or move the keys to the other edge, as on Gboard.
final class OneHandedPanelView: UIView {
  var onExpand: (() -> Void)?
  var onMove: (() -> Void)?
  private let expand = UIButton(type: .system)
  private let move = UIButton(type: .system)
  private var style: KeyboardStyle

  /// The edge the keys are docked to; the panel sits on the other side.
  var side: OneHandedMode = .right { didSet { if side != oldValue { updateMove() } } }

  init(style: KeyboardStyle) {
    self.style = style
    super.init(frame: .zero)
    accessibilityIdentifier = "one-handed-panel"
    let symbol = UIImage.SymbolConfiguration(pointSize: 18, weight: .regular)
    expand.setImage(UIImage(systemName: "arrow.up.left.and.arrow.down.right", withConfiguration: symbol), for: .normal)
    expand.accessibilityLabel = "Full width keyboard"
    expand.accessibilityIdentifier = "one-handed-expand"
    expand.addTarget(self, action: #selector(expandTapped), for: .touchUpInside)
    addSubview(expand)
    move.accessibilityIdentifier = "one-handed-move"
    move.addTarget(self, action: #selector(moveTapped), for: .touchUpInside)
    addSubview(move)
    updateMove()
    applyStyle(style)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  func applyStyle(_ style: KeyboardStyle) {
    self.style = style
    expand.tintColor = style.label
    move.tintColor = style.label
  }

  private func updateMove() {
    // Docked right, the panel is on the left and moves the keys left.
    let towardLeft = side != .left
    move.setImage(UIImage(systemName: towardLeft ? "chevron.left" : "chevron.right",
                          withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .semibold)), for: .normal)
    move.accessibilityLabel = towardLeft ? "Move keyboard left" : "Move keyboard right"
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let size = CGSize(width: min(bounds.width, 44), height: 44)
    let x = ((bounds.width - size.width) / 2).rounded()
    let gap: CGFloat = 18
    let top = ((bounds.height - size.height * 2 - gap) / 2).rounded()
    expand.frame = CGRect(origin: CGPoint(x: x, y: top), size: size)
    move.frame = CGRect(origin: CGPoint(x: x, y: expand.frame.maxY + gap), size: size)
  }

  @objc private func expandTapped() {
    KeyboardFeedback.current?.key(function: true)
    onExpand?()
  }

  @objc private func moveTapped() {
    KeyboardFeedback.current?.key(function: true)
    onMove?()
  }
}
#endif
