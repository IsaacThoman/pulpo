#if os(iOS)
import CoreText
import UIKit

protocol EmojiPanelDelegate: AnyObject {
  func emojiPanel(_ panel: EmojiPanelView, insert emoji: String)
  func emojiPanelDelete(_ panel: EmojiPanelView, wholeWord: Bool)
  func emojiPanelClose(_ panel: EmojiPanelView)
}

/// Emoji grid with categories, recents and skin tones, in the keyboard's footprint.
final class EmojiPanelView: UIView, UICollectionViewDataSource, UICollectionViewDelegate, UICollectionViewDelegateFlowLayout {
  weak var delegate: EmojiPanelDelegate?
  private var style: KeyboardStyle
  private let history: EmojiHistory
  private var sections: [(id: String, name: String, emoji: [Emoji])] = []
  private let header = UILabel()
  private let collection: UICollectionView
  private let toolbar = UIStackView()
  private var categoryButtons: [UIButton] = []
  private let abc = UIButton(type: .system)
  private let delete = UIButton(type: .system)
  private let tonePicker = KeyPopupView(style: KeyboardStyle(modern: true, dark: false, landscape: false))
  private var toneTarget: Emoji?
  private var deleteTimer: Timer?
  private var deleteRepeats = 0
  static let rows: CGFloat = 5

  static let symbols: [String: String] = [
    "recents": "clock", "smileys": "face.smiling", "animals": "pawprint", "food": "fork.knife",
    "activity": "basketball", "travel": "car", "objects": "lightbulb", "symbols": "heart", "flags": "flag",
  ]

  init(style: KeyboardStyle, catalog: EmojiCatalog, history: EmojiHistory) {
    self.style = style
    self.history = history
    let layout = UICollectionViewFlowLayout()
    layout.scrollDirection = .horizontal
    layout.minimumInteritemSpacing = 0
    layout.minimumLineSpacing = 0
    collection = UICollectionView(frame: .zero, collectionViewLayout: layout)
    super.init(frame: .zero)
    accessibilityIdentifier = "emoji-panel"
    sections = [("recents", "Frequently Used", [])] + catalog.categories.map { ($0.id, $0.name, $0.emoji) }
    reloadRecents()

    header.font = .systemFont(ofSize: 12, weight: .semibold)
    addSubview(header)
    collection.backgroundColor = .clear
    collection.showsHorizontalScrollIndicator = false
    collection.dataSource = self
    collection.delegate = self
    collection.register(EmojiCell.self, forCellWithReuseIdentifier: "emoji")
    collection.delaysContentTouches = false
    let hold = UILongPressGestureRecognizer(target: self, action: #selector(held(_:)))
    hold.minimumPressDuration = 0.35
    collection.addGestureRecognizer(hold)
    addSubview(collection)

    abc.setTitle("ABC", for: .normal)
    abc.titleLabel?.font = .systemFont(ofSize: 15, weight: .medium)
    abc.accessibilityIdentifier = "emoji-abc"
    abc.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
    addSubview(abc)
    toolbar.axis = .horizontal
    toolbar.distribution = .fillEqually
    addSubview(toolbar)
    for (index, section) in sections.enumerated() {
      let button = UIButton(type: .system)
      button.setImage(UIImage(systemName: Self.symbols[section.id] ?? "circle", withConfiguration: UIImage.SymbolConfiguration(pointSize: 15)), for: .normal)
      button.accessibilityLabel = section.name
      button.tag = index
      button.addTarget(self, action: #selector(categoryTapped(_:)), for: .touchUpInside)
      toolbar.addArrangedSubview(button)
      categoryButtons.append(button)
    }
    delete.setImage(UIImage(systemName: "delete.left", withConfiguration: UIImage.SymbolConfiguration(pointSize: 18)), for: .normal)
    delete.accessibilityLabel = "delete"
    delete.accessibilityIdentifier = "emoji-delete"
    delete.addTarget(self, action: #selector(deleteDown), for: .touchDown)
    delete.addTarget(self, action: #selector(deleteUp), for: [.touchUpInside, .touchUpOutside, .touchCancel])
    addSubview(delete)
    tonePicker.isHidden = true
    addSubview(tonePicker)
    applyStyle(style)
    filterUnsupported(catalog)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  func applyStyle(_ style: KeyboardStyle) {
    self.style = style
    header.textColor = style.secondaryLabel
    abc.tintColor = style.label
    delete.tintColor = style.label
    updateSelectedCategory()
  }

  private func reloadRecents() {
    var lookup: [String: Emoji] = [:]
    for section in sections.dropFirst() { for emoji in section.emoji { lookup[emoji.value] = emoji } }
    sections[0].emoji = history.recents.compactMap { value in
      lookup[value] ?? lookup.values.first { $0.tones?.contains(value) == true }.map { Emoji(value: value, name: $0.name, version: $0.version, tones: nil) }
    }
  }

  /// Hides emoji newer than the installed system font. Checked once per OS version.
  private func filterUnsupported(_ catalog: EmojiCatalog) {
    let key = "emojiUnsupported2-\(UIDevice.current.systemVersion)"
    if let cached = UserDefaults.standard.stringArray(forKey: key) {
      apply(unsupported: Set(cached))
      return
    }
    let all = catalog.categories.flatMap(\.emoji).map(\.value)
    Task.detached(priority: .utility) {
      let unsupported = all.filter { !Self.drawsAsOneGlyph($0) }
      await MainActor.run {
        UserDefaults.standard.set(unsupported, forKey: key)
        self.apply(unsupported: Set(unsupported))
      }
    }
  }

  private func apply(unsupported: Set<String>) {
    guard !unsupported.isEmpty else { return }
    for index in sections.indices { sections[index].emoji.removeAll { unsupported.contains($0.value) } }
    collection.reloadData()
  }

  /// Supported emoji render as one real glyph from the emoji font; missing ones fall
  /// back to the `.notdef` box (glyph 0) or split into several glyphs.
  nonisolated static func drawsAsOneGlyph(_ emoji: String) -> Bool {
    let font = CTFontCreateWithName("AppleColorEmoji" as CFString, 32, nil)
    let attributed = NSAttributedString(string: emoji, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
    let line = CTLineCreateWithAttributedString(attributed)
    guard CTLineGetGlyphCount(line) == 1, let run = (CTLineGetGlyphRuns(line) as? [CTRun])?.first else { return false }
    var glyph = CGGlyph(0)
    CTRunGetGlyphs(run, CFRange(location: 0, length: 1), &glyph)
    let attributes = CTRunGetAttributes(run) as NSDictionary
    let runFont = attributes[kCTFontAttributeName as String].map { $0 as! CTFont }
    let name = runFont.map { CTFontCopyPostScriptName($0) as String } ?? ""
    return glyph != 0 && name.contains("AppleColorEmoji")
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let toolbarHeight: CGFloat = 40
    header.frame = CGRect(x: 14, y: 6, width: bounds.width - 28, height: 18)
    collection.frame = CGRect(x: 0, y: 26, width: bounds.width, height: bounds.height - 26 - toolbarHeight)
    abc.frame = CGRect(x: 4, y: bounds.height - toolbarHeight, width: 50, height: toolbarHeight)
    delete.frame = CGRect(x: bounds.width - 50, y: bounds.height - toolbarHeight, width: 46, height: toolbarHeight)
    toolbar.frame = CGRect(x: abc.frame.maxX, y: bounds.height - toolbarHeight, width: delete.frame.minX - abc.frame.maxX, height: toolbarHeight)
    collection.collectionViewLayout.invalidateLayout()
    updateSelectedCategory()
  }

  // MARK: Grid

  func numberOfSections(in collectionView: UICollectionView) -> Int { sections.count }

  func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { sections[section].emoji.count }

  func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
    let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "emoji", for: indexPath) as! EmojiCell
    let emoji = sections[indexPath.section].emoji[indexPath.item]
    cell.label.text = indexPath.section == 0 ? emoji.value : history.preferred(for: emoji)
    cell.accessibilityLabel = emoji.name
    cell.accessibilityIdentifier = "emoji-\(emoji.value)"
    return cell
  }

  func collectionView(_ collectionView: UICollectionView, layout: UICollectionViewLayout, sizeForItemAt indexPath: IndexPath) -> CGSize {
    let height = floor(collectionView.bounds.height / Self.rows)
    return CGSize(width: max(40, height + 4), height: height)
  }

  func collectionView(_ collectionView: UICollectionView, layout: UICollectionViewLayout, insetForSectionAt section: Int) -> UIEdgeInsets {
    UIEdgeInsets(top: 0, left: 6, bottom: 0, right: 10)
  }

  func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
    let emoji = sections[indexPath.section].emoji[indexPath.item]
    let value = indexPath.section == 0 ? emoji.value : history.preferred(for: emoji)
    insert(value)
  }

  private func insert(_ value: String) {
    KeyboardFeedback.current?.key()
    UIDevice.current.playInputClick()
    history.use(value)
    delegate?.emojiPanel(self, insert: value)
  }

  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    updateSelectedCategory()
  }

  private var visibleSection: Int {
    let probe = CGPoint(x: collection.contentOffset.x + 30, y: collection.bounds.height / 2)
    if let path = collection.indexPathForItem(at: probe) { return path.section }
    return collection.indexPathsForVisibleItems.map(\.section).min() ?? 0
  }

  private func updateSelectedCategory() {
    let section = visibleSection
    header.text = sections.indices.contains(section) ? sections[section].name.uppercased() : nil
    for (index, button) in categoryButtons.enumerated() {
      button.tintColor = index == section ? style.label : style.secondaryLabel
    }
  }

  @objc private func categoryTapped(_ sender: UIButton) {
    let section = sender.tag
    guard sections.indices.contains(section) else { return }
    if sections[section].emoji.isEmpty {
      collection.setContentOffset(.zero, animated: false)
    } else if let attributes = collection.layoutAttributesForItem(at: IndexPath(item: 0, section: section)) {
      let x = min(attributes.frame.minX - 6, max(0, collection.contentSize.width - collection.bounds.width))
      collection.setContentOffset(CGPoint(x: max(0, x), y: 0), animated: false)
    }
    updateSelectedCategory()
  }

  // MARK: Skin tones

  @objc private func held(_ recognizer: UILongPressGestureRecognizer) {
    let point = recognizer.location(in: collection)
    switch recognizer.state {
    case .began:
      guard let path = collection.indexPathForItem(at: point), path.section > 0 else { return }
      let emoji = sections[path.section].emoji[path.item]
      guard let tones = emoji.tones, let cell = collection.cellForItem(at: path) else { return }
      toneTarget = emoji
      let rect = cell.convert(cell.bounds, to: self).insetBy(dx: 2, dy: 2)
      tonePicker.showAlternates([emoji.value] + tones, keyRect: rect, in: bounds, style: style)
      tonePicker.track(x: recognizer.location(in: self).x)
      KeyboardFeedback.current?.emphasis()
    case .changed:
      if toneTarget != nil { tonePicker.track(x: recognizer.location(in: self).x) }
    case .ended:
      if let target = toneTarget, let choice = tonePicker.selectedOption {
        history.setPreferred(choice, for: target)
        insert(choice)
        collection.reloadData()
      }
      fallthrough
    default:
      toneTarget = nil
      tonePicker.hide()
    }
  }

  // MARK: Toolbar

  @objc private func closeTapped() {
    delegate?.emojiPanelClose(self)
  }

  @objc private func deleteDown() {
    KeyboardFeedback.current?.key(function: true)
    UIDevice.current.playInputClick()
    delegate?.emojiPanelDelete(self, wholeWord: false)
    deleteRepeats = 0
    scheduleDelete(after: 0.45)
  }

  private func scheduleDelete(after delay: TimeInterval) {
    deleteTimer?.invalidate()
    let timer = Timer(timeInterval: delay, repeats: false) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self else { return }
        self.deleteRepeats += 1
        self.delegate?.emojiPanelDelete(self, wholeWord: self.deleteRepeats > 14)
        self.scheduleDelete(after: self.deleteRepeats > 14 ? 0.24 : 0.085)
      }
    }
    RunLoop.main.add(timer, forMode: .common)
    deleteTimer = timer
  }

  @objc private func deleteUp() {
    deleteTimer?.invalidate()
    deleteTimer = nil
  }
}

final class EmojiCell: UICollectionViewCell {
  let label = UILabel()

  override init(frame: CGRect) {
    super.init(frame: frame)
    label.font = .systemFont(ofSize: 30)
    label.textAlignment = .center
    contentView.addSubview(label)
    isAccessibilityElement = true
    accessibilityTraits = .keyboardKey
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override func layoutSubviews() {
    super.layoutSubviews()
    label.frame = contentView.bounds
  }

  override var isHighlighted: Bool {
    didSet {
      contentView.backgroundColor = isHighlighted ? UIColor.label.withAlphaComponent(0.1) : .clear
      contentView.layer.cornerRadius = 8
    }
  }
}
#endif
