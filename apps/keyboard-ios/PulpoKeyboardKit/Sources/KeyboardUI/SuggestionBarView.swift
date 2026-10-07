#if os(iOS)
import UIKit

/// Three QuickType-style suggestion slots with the dictation key at the end.
final class SuggestionBarView: UIView {
  var onSelect: ((Suggestion) -> Void)?
  var onForget: ((Suggestion) -> Void)?
  var onMicrophone: (() -> Void)?
  var onSettings: (() -> Void)?

  private var style: KeyboardStyle
  private let slots = (0..<3).map { _ in SlotControl() }
  private let dividers = (0..<2).map { _ in CALayer() }
  private let microphone = UIButton(type: .system)
  private let settings = UIButton(type: .system)
  private let notice = NoticeView()
  private(set) var suggestions: [Suggestion] = []
  private var pendingForget: Suggestion?

  init(style: KeyboardStyle) {
    self.style = style
    super.init(frame: .zero)
    for (index, slot) in slots.enumerated() {
      slot.accessibilityIdentifier = "suggestion-\(index)"
      slot.addTarget(self, action: #selector(slotTapped(_:)), for: .touchUpInside)
      slot.addGestureRecognizer(UILongPressGestureRecognizer(target: self, action: #selector(slotHeld(_:))))
      addSubview(slot)
    }
    dividers.forEach { layer.addSublayer($0) }
    microphone.setImage(UIImage(systemName: "mic"), for: .normal)
    microphone.accessibilityLabel = "Dictate"
    microphone.accessibilityIdentifier = "dictate"
    microphone.addTarget(self, action: #selector(microphoneTapped), for: .touchUpInside)
    addSubview(microphone)
    settings.setImage(UIImage(systemName: "slider.horizontal.3"), for: .normal)
    settings.accessibilityLabel = "Pulpo Keyboard settings"
    settings.accessibilityIdentifier = "keyboard-settings"
    settings.addTarget(self, action: #selector(settingsTapped), for: .touchUpInside)
    addSubview(settings)
    notice.isHidden = true
    addSubview(notice)
    applyStyle(style)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  func applyStyle(_ style: KeyboardStyle) {
    self.style = style
    let symbol = UIImage.SymbolConfiguration(pointSize: 19, weight: .regular)
    microphone.setPreferredSymbolConfiguration(symbol, forImageIn: .normal)
    settings.setPreferredSymbolConfiguration(UIImage.SymbolConfiguration(pointSize: 17, weight: .regular), forImageIn: .normal)
    microphone.tintColor = style.label
    settings.tintColor = style.secondaryLabel
    for divider in dividers { divider.backgroundColor = style.divider.cgColor }
    slots.forEach { $0.apply(style) }
    notice.apply(style)
    setSuggestions(suggestions)
  }

  var microphoneVisible = true { didSet { setNeedsLayout() } }

  func setSuggestions(_ suggestions: [Suggestion]) {
    self.suggestions = suggestions
    pendingForget = nil
    let showSlots = !suggestions.isEmpty
    for (index, slot) in slots.enumerated() {
      let suggestion = suggestions.indices.contains(index) ? suggestions[index] : nil
      slot.configure(suggestion, style: style)
      slot.isHidden = !showSlots
    }
    // The literal is quoted when it means "keep what I typed" rather than being the main pick.
    let hasAutocorrection = suggestions.contains(where: \.isAutocorrection)
    for (index, slot) in slots.enumerated() where slot.suggestion?.kind == .literal {
      slot.setQuoted(index != 1 || hasAutocorrection)
    }
    settings.isHidden = showSlots
    for (index, divider) in dividers.enumerated() {
      // A divider sits between two filled slots, like QuickType.
      let left = suggestions.indices.contains(index)
      let right = suggestions.indices.contains(index + 1)
      divider.isHidden = !(showSlots && left && right)
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let micWidth: CGFloat = microphoneVisible ? 46 : 0
    microphone.isHidden = !microphoneVisible
    microphone.frame = CGRect(x: bounds.width - micWidth - 2, y: 0, width: micWidth, height: bounds.height)
    settings.frame = CGRect(x: 4, y: 0, width: 44, height: bounds.height)
    let inset: CGFloat = microphoneVisible ? 6 : 0
    let available = bounds.width - micWidth - inset
    let slotWidth = available / 3
    for (index, slot) in slots.enumerated() {
      slot.frame = CGRect(x: inset + CGFloat(index) * slotWidth, y: 2, width: slotWidth, height: bounds.height - 4)
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for (index, divider) in dividers.enumerated() {
      let x = inset + CGFloat(index + 1) * slotWidth
      divider.frame = CGRect(x: x - 0.5, y: bounds.height / 2 - 12.5, width: 1 / max(traitCollection.displayScale, 1), height: 25)
    }
    CATransaction.commit()
    notice.frame = bounds
  }

  func setMicrophoneActive(_ active: Bool) {
    microphone.setImage(UIImage(systemName: active ? "mic.fill" : "mic"), for: .normal)
    microphone.tintColor = active ? style.accent : style.label
  }

  func showNotice(_ text: String, action: String? = nil, handler: (() -> Void)? = nil) {
    notice.show(text, action: action, handler: handler)
    bringSubviewToFront(notice)
  }

  func hideNotice() {
    notice.isHidden = true
  }

  var isShowingNotice: Bool { !notice.isHidden }

  @objc private func slotTapped(_ sender: SlotControl) {
    guard let suggestion = sender.suggestion else { return }
    KeyboardFeedback.current?.key()
    onSelect?(suggestion)
  }

  @objc private func slotHeld(_ recognizer: UILongPressGestureRecognizer) {
    guard recognizer.state == .began, let slot = recognizer.view as? SlotControl, let suggestion = slot.suggestion,
          suggestion.kind != .literal else { return }
    KeyboardFeedback.current?.emphasis()
    pendingForget = suggestion
    showNotice("Stop suggesting \u{201C}\(suggestion.text)\u{201D}?", action: "Remove") { [weak self] in
      guard let self, let pending = self.pendingForget else { return }
      self.onForget?(pending)
      self.hideNotice()
    }
  }

  @objc private func microphoneTapped() {
    KeyboardFeedback.current?.key(function: true)
    onMicrophone?()
  }

  @objc private func settingsTapped() {
    onSettings?()
  }
}

final class SlotControl: UIControl {
  private let label = UILabel()
  private let highlight = CALayer()
  private(set) var suggestion: Suggestion?
  private var style: KeyboardStyle?

  override init(frame: CGRect) {
    super.init(frame: frame)
    highlight.cornerRadius = 8
    highlight.cornerCurve = .continuous
    highlight.opacity = 0
    layer.addSublayer(highlight)
    label.textAlignment = .center
    label.adjustsFontSizeToFitWidth = true
    label.minimumScaleFactor = 0.65
    label.lineBreakMode = .byTruncatingMiddle
    addSubview(label)
    isAccessibilityElement = true
    accessibilityTraits = .button
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  func apply(_ style: KeyboardStyle) {
    self.style = style
    highlight.backgroundColor = (style.dark ? UIColor(white: 1, alpha: 0.14) : UIColor(white: 1, alpha: 0.75)).cgColor
  }

  func configure(_ suggestion: Suggestion?, style: KeyboardStyle) {
    self.suggestion = suggestion
    guard let suggestion else {
      label.text = nil
      accessibilityLabel = nil
      isEnabled = false
      return
    }
    isEnabled = true
    label.text = suggestion.text
    label.font = suggestion.isAutocorrection ? style.suggestionEmphasisFont : style.suggestionFont
    label.textColor = style.label
    accessibilityLabel = suggestion.text
    accessibilityValue = suggestion.isAutocorrection ? "autocorrection" : nil
  }

  /// Quotes only make sense when the literal differs from what will be inserted.
  func setQuoted(_ quoted: Bool) {
    guard let suggestion else { return }
    label.text = quoted ? "\u{201C}\(suggestion.text)\u{201D}" : suggestion.text
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    label.frame = bounds.insetBy(dx: 6, dy: 0)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    highlight.frame = bounds.insetBy(dx: 3, dy: 3)
    CATransaction.commit()
  }

  override var isHighlighted: Bool {
    didSet { highlight.opacity = isHighlighted ? 1 : 0 }
  }
}

/// A one-line message that temporarily replaces the suggestion bar.
final class NoticeView: UIView {
  private let label = UILabel()
  private let button = UIButton(type: .system)
  private let close = UIButton(type: .system)
  private var handler: (() -> Void)?

  override init(frame: CGRect) {
    super.init(frame: frame)
    label.font = .systemFont(ofSize: 14, weight: .regular)
    label.numberOfLines = 2
    label.adjustsFontSizeToFitWidth = true
    label.minimumScaleFactor = 0.75
    addSubview(label)
    button.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
    button.addTarget(self, action: #selector(act), for: .touchUpInside)
    button.accessibilityIdentifier = "notice-action"
    addSubview(button)
    close.setImage(UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 13, weight: .semibold)), for: .normal)
    close.accessibilityLabel = "Dismiss"
    close.accessibilityIdentifier = "notice-dismiss"
    close.addTarget(self, action: #selector(dismiss), for: .touchUpInside)
    addSubview(close)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  func apply(_ style: KeyboardStyle) {
    backgroundColor = style.background
    label.textColor = style.label
    close.tintColor = style.secondaryLabel
    button.tintColor = style.accent
  }

  func show(_ text: String, action: String?, handler: (() -> Void)?) {
    label.text = text
    accessibilityIdentifier = "notice"
    button.setTitle(action, for: .normal)
    button.isHidden = action == nil
    self.handler = handler
    isHidden = false
    setNeedsLayout()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let closeWidth: CGFloat = 36
    close.frame = CGRect(x: bounds.width - closeWidth - 4, y: 0, width: closeWidth, height: bounds.height)
    let buttonWidth = button.isHidden ? 0 : min(150, button.intrinsicContentSize.width + 16)
    button.frame = CGRect(x: close.frame.minX - buttonWidth, y: 0, width: buttonWidth, height: bounds.height)
    label.frame = CGRect(x: 14, y: 0, width: button.frame.minX - 18, height: bounds.height)
  }

  @objc private func act() { handler?() }
  @objc private func dismiss() { isHidden = true }
}
#endif
