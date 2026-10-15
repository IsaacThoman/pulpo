#if os(iOS)
import UIKit

/// The emoji search row, in the suggestion bar's place above the letter keys:
/// back to the picker, the search field showing the typed query, and a strip of
/// matching emoji. A keyboard can't focus a text field inside its own view, so
/// the field is a label over the keyboard's own query buffer, as on Gboard.
final class EmojiSearchBarView: UIView {
  var onBack: (() -> Void)?
  var onSelect: ((EmojiSearchResult) -> Void)?

  private var style: KeyboardStyle
  private let back = UIButton(type: .system)
  private let field = SearchFieldView()
  private let strip = ResultStripView()
  private let empty = UILabel()
  private(set) var query = ""
  private(set) var results: [EmojiSearchResult] = []
  private var cells: [EmojiResultControl] = []

  init(style: KeyboardStyle) {
    self.style = style
    super.init(frame: .zero)
    accessibilityIdentifier = "emoji-search"
    back.setImage(UIImage(systemName: "chevron.left", withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .semibold)), for: .normal)
    back.accessibilityLabel = "Back to emoji"
    back.accessibilityIdentifier = "emoji-search-back"
    back.addTarget(self, action: #selector(backTapped), for: .touchUpInside)
    addSubview(back)
    addSubview(field)
    strip.showsHorizontalScrollIndicator = false
    strip.showsVerticalScrollIndicator = false
    strip.alwaysBounceHorizontal = true
    strip.delaysContentTouches = false
    strip.contentInsetAdjustmentBehavior = .never
    if #available(iOS 26, *) {
      strip.leftEdgeEffect.isHidden = true
      strip.rightEdgeEffect.isHidden = true
    }
    strip.accessibilityIdentifier = "emoji-search-results"
    addSubview(strip)
    empty.text = "No emoji found"
    empty.font = .systemFont(ofSize: 15)
    empty.textAlignment = .center
    empty.adjustsFontSizeToFitWidth = true
    empty.minimumScaleFactor = 0.75
    empty.accessibilityIdentifier = "emoji-search-empty"
    empty.isHidden = true
    addSubview(empty)
    applyStyle(style)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  func applyStyle(_ style: KeyboardStyle) {
    self.style = style
    back.tintColor = style.label
    empty.textColor = style.secondaryLabel
    field.apply(style)
    cells.forEach { $0.apply(style) }
    setNeedsLayout()
  }

  /// Shows `query` in the field and `results` in the strip, scrolled to the start.
  func show(query: String, results: [EmojiSearchResult]) {
    let changed = results != self.results
    self.query = query
    self.results = results
    field.query = query
    empty.isHidden = !results.isEmpty || query.trimmingCharacters(in: .whitespaces).isEmpty
    if changed {
      cells.forEach { $0.removeFromSuperview() }
      cells = results.map { result in
        let cell = EmojiResultControl(result: result)
        cell.apply(style)
        cell.addTarget(self, action: #selector(resultTapped(_:)), for: .touchUpInside)
        strip.addSubview(cell)
        return cell
      }
      strip.contentOffset = .zero
    }
    setNeedsLayout()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let height = bounds.height
    back.frame = CGRect(x: 0, y: 0, width: 36, height: height)
    let fieldHeight = min(32, height - 8)
    let fieldWidth = min(max(field.preferredWidth, 136), (bounds.width * 0.46).rounded())
    field.frame = CGRect(x: back.frame.maxX, y: ((height - fieldHeight) / 2).rounded(), width: fieldWidth, height: fieldHeight)
    let stripX = field.frame.maxX + 4
    strip.frame = CGRect(x: stripX, y: 0, width: max(0, bounds.width - stripX - 2), height: height)
    empty.frame = strip.frame.insetBy(dx: 6, dy: 0)
    let cell = style.landscape ? 38.0 : 42.0
    for (index, view) in cells.enumerated() {
      view.frame = CGRect(x: CGFloat(index) * cell, y: 0, width: cell, height: height)
    }
    strip.contentSize = CGSize(width: CGFloat(cells.count) * cell, height: height)
  }

  @objc private func backTapped() {
    KeyboardFeedback.current?.key(function: true)
    onBack?()
  }

  @objc private func resultTapped(_ sender: EmojiResultControl) {
    KeyboardFeedback.current?.key()
    UIDevice.current.playInputClick()
    onSelect?(sender.result)
  }
}

/// Results are controls, which a scroll view won't take touches back from by
/// default; a drag across them must still scroll the strip.
final class ResultStripView: UIScrollView {
  override func touchesShouldCancel(in view: UIView) -> Bool { true }
}

/// The search field: a magnifier, the query or placeholder, and a caret.
final class SearchFieldView: UIView {
  private let magnifier = UIImageView(image: UIImage(systemName: "magnifyingglass"))
  private let label = UILabel()
  private let caret = CALayer()
  private var style: KeyboardStyle?

  var query = "" {
    didSet {
      guard query != oldValue else { return }
      updateText()
    }
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    layer.cornerRadius = 9
    layer.cornerCurve = .continuous
    magnifier.contentMode = .center
    magnifier.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 14, weight: .medium)
    addSubview(magnifier)
    label.font = .systemFont(ofSize: 16)
    label.lineBreakMode = .byTruncatingHead
    addSubview(label)
    caret.cornerRadius = 1
    layer.addSublayer(caret)
    isAccessibilityElement = true
    accessibilityLabel = "Search emoji"
    accessibilityTraits = .searchField
    accessibilityIdentifier = "emoji-search-field"
    blink()
    updateText()
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  func apply(_ style: KeyboardStyle) {
    self.style = style
    backgroundColor = style.dark ? UIColor(white: 1, alpha: 0.14) : UIColor(white: 1, alpha: 0.75)
    magnifier.tintColor = style.secondaryLabel
    caret.backgroundColor = style.accent.cgColor
    updateText()
  }

  /// Room for the query (or placeholder) and the magnifier.
  var preferredWidth: CGFloat {
    ceil(label.intrinsicContentSize.width) + 44
  }

  private func updateText() {
    label.text = query.isEmpty ? "Search Emoji" : query
    label.textColor = query.isEmpty ? style?.secondaryLabel : style?.label
    accessibilityValue = query.isEmpty ? nil : query
    superview?.setNeedsLayout()
    setNeedsLayout()
  }

  private func blink() {
    let animation = CABasicAnimation(keyPath: "opacity")
    animation.fromValue = 1
    animation.toValue = 0
    animation.duration = 0.5
    animation.autoreverses = true
    animation.repeatCount = .infinity
    animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
    caret.add(animation, forKey: "blink")
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    // Animations stop when a view leaves the window; restart on return.
    if window != nil { blink() }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    magnifier.frame = CGRect(x: 6, y: 0, width: 22, height: bounds.height)
    let textX = magnifier.frame.maxX + 2
    let available = max(0, bounds.width - textX - 10)
    let width = min(ceil(label.intrinsicContentSize.width), available)
    label.frame = CGRect(x: textX, y: 0, width: available, height: bounds.height)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    // The caret follows the query; before the placeholder when empty.
    let caretX = query.isEmpty ? textX - 1 : textX + width + 1
    caret.frame = CGRect(x: caretX, y: (bounds.height - 18) / 2, width: 2, height: 18)
    CATransaction.commit()
  }
}

/// One emoji in the results strip.
final class EmojiResultControl: UIControl {
  let result: EmojiSearchResult
  private let label = UILabel()
  private let highlight = CALayer()

  init(result: EmojiSearchResult) {
    self.result = result
    super.init(frame: .zero)
    highlight.cornerRadius = 8
    highlight.cornerCurve = .continuous
    highlight.opacity = 0
    layer.addSublayer(highlight)
    label.text = result.value
    label.font = .systemFont(ofSize: 27)
    label.textAlignment = .center
    label.isUserInteractionEnabled = false
    addSubview(label)
    isAccessibilityElement = true
    accessibilityTraits = .keyboardKey
    accessibilityLabel = result.name
    accessibilityIdentifier = "emoji-result-\(result.value)"
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  func apply(_ style: KeyboardStyle) {
    highlight.backgroundColor = (style.dark ? UIColor(white: 1, alpha: 0.14) : UIColor(white: 1, alpha: 0.75)).cgColor
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    label.frame = bounds
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    highlight.frame = bounds.insetBy(dx: 2, dy: 4)
    CATransaction.commit()
  }

  override var isHighlighted: Bool {
    didSet { highlight.opacity = isHighlighted ? 1 : 0 }
  }
}
#endif
