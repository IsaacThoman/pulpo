import XCTest
import UIKit
@testable import KeyboardUI

/// Emoji layout uses the same panel in the preview and the installed extension.
@MainActor
final class EmojiPanelTests: XCTestCase {
  private var defaults: UserDefaults!

  override func setUp() async throws {
    defaults = UserDefaults(suiteName: "EmojiPanelTests-\(UUID().uuidString)")!
  }

  override func tearDown() async throws {
    defaults = nil
  }

  func testEmojiGlyphsFitPortraitAndLandscapeCells() throws {
    for landscape in [false, true] {
      for inset in [false, true] {
        let style = KeyboardStyle(modern: true, dark: false, landscape: landscape, inset: inset)
        let panel = try makePanel(style: style, width: landscape ? 667 : 375)
        let collection = try XCTUnwrap(panel.subviews.compactMap { $0 as? UICollectionView }.first)
        let cells = collection.visibleCells.compactMap { $0 as? EmojiCell }
        XCTAssertFalse(cells.isEmpty)
        for cell in cells {
          XCTAssertLessThanOrEqual(cell.label.font.lineHeight, cell.label.bounds.height + 1,
                                   "Emoji clipped in \(landscape ? "landscape" : "portrait") \(inset ? "installed" : "preview")")
          XCTAssertGreaterThanOrEqual(cell.frame.minY, collection.bounds.minY)
          XCTAssertLessThanOrEqual(cell.frame.maxY, collection.bounds.maxY, "Emoji row crosses the grid edge")
        }
        save(panel, name: "emoji-\(landscape ? "landscape" : "portrait")-\(inset ? "installed" : "preview")")
      }
    }
  }

  func testCategoryToolbarRemainsInsidePanel() throws {
    for landscape in [false, true] {
      let style = KeyboardStyle(modern: true, dark: false, landscape: landscape, inset: true)
      let panel = try makePanel(style: style, width: landscape ? 667 : 320)
      let buttons = panel.subviews.compactMap { $0 as? UIButton }
        + panel.subviews.compactMap { $0 as? UIStackView }.flatMap { $0.arrangedSubviews.compactMap { $0 as? UIButton } }
      XCTAssertEqual(buttons.count, 11)
      for button in buttons {
        let rect = button.convert(button.bounds, to: panel)
        XCTAssertTrue(panel.bounds.contains(rect), "\(button.accessibilityLabel ?? button.currentTitle ?? "button") leaves panel")
        XCTAssertTrue(panel.hitTest(CGPoint(x: rect.midX, y: rect.midY), with: nil) === button)
      }
    }
  }

  func testGridKeepsItsOwnInsetsInsideASafeAreaWindow() async throws {
    let style = KeyboardStyle(modern: true, dark: false, landscape: false, inset: true)
    let window = UIWindow(frame: UIScreen.main.bounds)
    let host = UIViewController()
    host.additionalSafeAreaInsets = UIEdgeInsets(top: 0, left: 16, bottom: 0, right: 16)
    window.rootViewController = host
    window.makeKeyAndVisible()
    defer { window.isHidden = true }
    let panel = try makePanel(style: style, width: window.bounds.width)
    panel.frame.origin.y = 200
    host.view.addSubview(panel)
    window.layoutIfNeeded()
    host.view.layoutIfNeeded()
    panel.layoutIfNeeded()
    try await Task.sleep(for: .milliseconds(300))
    let collection = try XCTUnwrap(panel.subviews.compactMap { $0 as? UICollectionView }.first)
    collection.layoutIfNeeded()
    XCTAssertEqual(panel.safeAreaInsets.left, 16, accuracy: 0.5)
    let cell = try XCTUnwrap(collection.cellForItem(at: IndexPath(item: 0, section: 1)))
    XCTAssertEqual(cell.convert(cell.bounds, to: panel).minX, 6, accuracy: 0.5,
                   "The host safe area must not add a second inset to the emoji grid")
    XCTAssertEqual(collection.contentOffset.y, 0, accuracy: 0.5)
    XCTAssertEqual(collection.adjustedContentInset, .zero)
    if #available(iOS 26, *) {
      XCTAssertTrue(collection.topEdgeEffect.isHidden)
      XCTAssertTrue(collection.bottomEdgeEffect.isHidden)
    }
    save(panel, name: "emoji-safe-area-window")
  }

  func testRecentsRefreshWhenReturningToCategory() throws {
    let style = KeyboardStyle(modern: true, dark: false, landscape: false)
    let panel = try makePanel(style: style, width: 375)
    let collection = try XCTUnwrap(panel.subviews.compactMap { $0 as? UICollectionView }.first)
    XCTAssertEqual(panel.collectionView(collection, numberOfItemsInSection: 0), 0)
    panel.collectionView(collection, didSelectItemAt: IndexPath(item: 0, section: 1))
    let toolbar = try XCTUnwrap(panel.subviews.compactMap { $0 as? UIStackView }.first)
    let recents = try XCTUnwrap(toolbar.arrangedSubviews.first as? UIButton)
    recents.sendActions(for: .touchUpInside)
    collection.layoutIfNeeded()
    XCTAssertEqual(panel.collectionView(collection, numberOfItemsInSection: 0), 1)
    XCTAssertEqual((collection.cellForItem(at: IndexPath(item: 0, section: 0)) as? EmojiCell)?.label.text, "😀")
    XCTAssertEqual(panel.subviews.compactMap { $0 as? UILabel }.first?.text, "FREQUENTLY USED")
  }

  func testInstalledPickerKeepsAllRowsBelowHeader() {
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launchArguments = ["-PKPreview", "-PKSystemKeyboard"]
    app.launch()
    let field = app.textViews["system-text"].exists ? app.textViews["system-text"] : app.textFields["system-text"]
    XCTAssertTrue(field.waitForExistence(timeout: 8))
    if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { field.tap() }
    for _ in 0..<4 {
      if app.key("key-q").waitForExistence(timeout: 2) { break }
      let globe = app.buttons["Next keyboard"].firstMatch
      if globe.exists { globe.tap() } else { break }
    }
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 3), app.debugDescription)
    app.key("key-emoji").tap()
    let panel = app.key("emoji-panel")
    XCTAssertTrue(panel.waitForExistence(timeout: 6))
    app.buttons["Smileys & People"].tap()
    snapshot("installed-emoji-picker")
    let first = app.key("emoji-😀")
    XCTAssertTrue(first.exists)
    XCTAssertTrue(first.isHittable)
    let footer = app.buttons["emoji-abc"]
    let header = panel.staticTexts["SMILEYS & PEOPLE"]
    XCTAssertTrue(header.exists)
    XCTAssertGreaterThanOrEqual(first.frame.minY, header.frame.maxY)
    XCTAssertLessThan(first.frame.maxY, footer.frame.minY)
  }

  func testPreviewPickerAfterHorizontalScroll() {
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launchArguments = ["-PKPreview"]
    app.launch()
    XCTAssertTrue(app.key("key-emoji").waitForExistence(timeout: 8))
    app.key("key-emoji").tap()
    XCTAssertTrue(app.key("emoji-panel").waitForExistence(timeout: 6))
    snapshot("preview-picker-start")
    let collection = app.collectionViews.firstMatch
    collection.swipeLeft()
    snapshot("preview-picker-scrolled")
    collection.swipeRight()
    snapshot("preview-picker-returned")
    XCTAssertTrue(app.buttons["emoji-abc"].isHittable)
  }

  private func makePanel(style: KeyboardStyle, width: CGFloat) throws -> EmojiPanelView {
    let values = ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🙂", "🙃", "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "☺️", "😚", "😙"]
    let names = [("smileys", "Smileys"), ("animals", "Animals"), ("food", "Food"), ("activity", "Activity"), ("travel", "Travel"), ("objects", "Objects"), ("symbols", "Symbols"), ("flags", "Flags")]
    let categories: [[String: Any]] = names.map { id, name in
      ["id": id, "name": name, "emoji": values.map { ["e": $0, "n": $0, "v": 1] as [String: Any] }]
    }
    let data = try JSONSerialization.data(withJSONObject: ["version": "test", "categories": categories])
    let catalog = try JSONDecoder().decode(EmojiCatalog.self, from: data)
    let panel = EmojiPanelView(style: style, catalog: catalog, history: EmojiHistory(defaults: defaults))
    panel.frame = CGRect(x: 0, y: 0, width: width, height: style.totalHeight)
    panel.backgroundColor = style.background
    panel.layoutIfNeeded()
    let collection = try XCTUnwrap(panel.subviews.compactMap { $0 as? UICollectionView }.first)
    collection.layoutIfNeeded()
    return panel
  }

  private func save(_ panel: UIView, name: String) {
    let image = UIGraphicsImageRenderer(bounds: panel.bounds).image { context in
      panel.layer.render(in: context.cgContext)
    }
    let attachment = XCTAttachment(image: image)
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
    if let directory = ProcessInfo.processInfo.environment["PK_SCREENSHOT_DIR"] {
      try? image.pngData()?.write(to: URL(fileURLWithPath: directory).appendingPathComponent("\(name).png"))
    }
  }
}
