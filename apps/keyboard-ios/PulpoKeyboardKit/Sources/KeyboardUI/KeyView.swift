#if os(iOS)
import UIKit

/// One key cap. Drawn with plain layers and labels so a full page builds in well under a frame.
final class KeyView: UIView {
  let key: Key
  private let face = CALayer()
  private let label = UILabel()
  private let symbol = UIImageView()
  private let hint = UILabel()
  private(set) var style: KeyboardStyle

  var isPressed = false { didSet { if isPressed != oldValue { applyColors() } } }
  var isEnabled = true { didSet { if isEnabled != oldValue { applyColors() } } }
  var shift: ShiftState = .off { didSet { if shift != oldValue { applyContent() } } }
  /// Blanks labels while the space bar works as a trackpad.
  var isDimmed = false { didSet { label.alpha = isDimmed ? 0 : 1; symbol.alpha = isDimmed ? 0 : 1; hint.alpha = isDimmed ? 0 : 1 } }

  init(key: Key, style: KeyboardStyle) {
    self.key = key
    self.style = style
    super.init(frame: .zero)
    isUserInteractionEnabled = false
    face.cornerCurve = .continuous
    layer.addSublayer(face)
    label.textAlignment = .center
    label.adjustsFontSizeToFitWidth = true
    label.minimumScaleFactor = 0.6
    addSubview(label)
    symbol.contentMode = .center
    addSubview(symbol)
    hint.textAlignment = .center
    addSubview(hint)
    isAccessibilityElement = true
    accessibilityTraits = .keyboardKey
    accessibilityIdentifier = key.identifier
    applyStyle(style)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  func applyStyle(_ style: KeyboardStyle) {
    self.style = style
    face.cornerRadius = style.cornerRadius
    if style.modern {
      face.shadowOpacity = 0
    } else {
      face.shadowColor = style.keyShadow.cgColor
      face.shadowOpacity = 1
      face.shadowRadius = 0
      face.shadowOffset = CGSize(width: 0, height: 1)
    }
    hint.font = style.hintFont
    hint.textColor = style.secondaryLabel
    applyContent()
    applyColors()
  }

  var isReturnHighlighted: Bool {
    if case .returnKey = key.action { return key.label != "return" && key.label != "Emergency" }
    return false
  }

  private func applyColors() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    let base: UIColor
    let pressed: UIColor
    if isReturnHighlighted, isEnabled {
      base = style.accent
      pressed = style.pressedFunctionKey
    } else if key.style == .input {
      base = style.inputKey
      pressed = style.pressedInputKey
    } else {
      base = style.functionKey
      pressed = style.pressedFunctionKey
    }
    face.backgroundColor = (isPressed ? pressed : base).cgColor
    if case .text("") = key.action { face.backgroundColor = UIColor.clear.cgColor; face.shadowOpacity = 0 }
    let foreground: UIColor = isReturnHighlighted && isEnabled && !isPressed ? .white : style.label
    label.textColor = isEnabled ? foreground : style.secondaryLabel
    symbol.tintColor = isEnabled ? foreground : style.secondaryLabel
    CATransaction.commit()
  }

  private func applyContent() {
    label.isHidden = false
    symbol.isHidden = true
    var name: String?
    switch key.action {
    case .character(let text):
      let upper = shift.isActive && text.first?.isLetter == true
      label.text = upper ? text.uppercased() : text
      label.font = text.first?.isLetter == true ? (upper ? style.uppercaseLetterFont : style.lowercaseLetterFont) : style.symbolFont
      accessibilityLabel = label.text
    case .shift:
      name = switch shift {
      case .off: "shift"
      case .once: "shift.fill"
      case .locked: "capslock.fill"
      }
      accessibilityLabel = "shift"
      accessibilityValue = shift == .locked ? "caps lock" : shift.isActive ? "on" : "off"
    case .delete:
      name = "delete.left"
      accessibilityLabel = "delete"
    case .nextKeyboard:
      name = "globe"
      accessibilityLabel = "next keyboard"
    case .emoji:
      name = "face.smiling"
      accessibilityLabel = "emoji"
    case .space:
      label.text = style.modern ? "" : "space"
      label.font = style.functionFont
      accessibilityLabel = "space"
    case .returnKey:
      if style.modern, key.label == "return" {
        name = "return.left"
      } else {
        label.text = key.label
        label.font = style.functionFont
      }
      accessibilityLabel = key.label
    case .page, .text:
      label.text = key.label
      label.font = key.label.count > 3 ? style.functionFont : (key.label == "123" || key.label == "ABC" || key.label == "#+=" ? style.functionFont : style.symbolFont)
      accessibilityLabel = key.label
    }
    if let name {
      label.isHidden = true
      symbol.isHidden = false
      symbol.image = UIImage(systemName: name, withConfiguration: style.symbolConfiguration)
    }
    hint.text = key.hint
    hint.isHidden = key.hint == nil
    setNeedsLayout()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    face.frame = bounds
    face.shadowPath = style.modern ? nil : UIBezierPath(roundedRect: bounds, cornerRadius: style.cornerRadius).cgPath
    CATransaction.commit()
    // The system keyboard sits letters slightly above center.
    let lift: CGFloat = key.isCharacter && label.text?.first?.isLowercase == true ? 2 : 1
    label.frame = bounds.insetBy(dx: 2, dy: 0).offsetBy(dx: 0, dy: -lift)
    symbol.frame = bounds
    if key.hint != nil {
      if case .character(let text) = key.action, text.first?.isNumber == true {
        // Number pad: letters under the digit.
        label.frame = CGRect(x: 0, y: 2, width: bounds.width, height: bounds.height * 0.62)
        hint.frame = CGRect(x: 0, y: bounds.height * 0.6, width: bounds.width, height: 12)
      } else {
        hint.frame = CGRect(x: bounds.width - 12, y: 2, width: 10, height: 12)
      }
    }
  }

  override func accessibilityActivate() -> Bool {
    (superview as? KeysView)?.activateForAccessibility(self)
    return true
  }
}
#endif
