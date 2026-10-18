import XCTest
import UIKit
@testable import KeyboardUI

/// The emoji search row and its keys, laid out in every keyboard style.
@MainActor
final class EmojiSearchLayoutTests: XCTestCase {
  private let values = ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🙂", "🙃", "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "🍕", "❤️"]

  private func results(_ count: Int) -> [EmojiSearchResult] {
    values.prefix(count).enumerated().map { index, value in
      EmojiSearchResult(value: value, base: Emoji(value: value, name: "emoji \(index)", version: 1, tones: nil))
    }
  }

  private func styles() -> [(name: String, style: KeyboardStyle, width: CGFloat)] {
    var styles: [(String, KeyboardStyle, CGFloat)] = []
    for dark in [false, true] {
      for inset in [false, true] {
        let tone = dark ? "dark" : "light"
        let host = inset ? "installed" : "preview"
        styles.append(("portrait-\(host)-\(tone)", KeyboardStyle(modern: true, dark: dark, landscape: false, inset: inset), 393))
        styles.append(("compact-\(host)-\(tone)", KeyboardStyle(modern: true, dark: dark, landscape: false, inset: inset), 375))
        styles.append(("landscape-\(host)-\(tone)", KeyboardStyle(modern: true, dark: dark, landscape: true, inset: inset), 852))
      }
    }
    styles.append(("portrait-ios18-light", KeyboardStyle(modern: false, dark: false, landscape: false), 393))
    return styles
  }

  private func searchRoot(_ style: KeyboardStyle, width: CGFloat, query: String, count: Int) -> KeyboardRootView {
    let root = KeyboardRootView(style: style, layout: KeyboardLayout.emojiSearch())
    root.frame = CGRect(x: 0, y: 0, width: width, height: style.totalHeight)
    root.paintsBackground = true
    root.mode = .emojiSearch
    root.search.show(query: query, results: results(count))
    root.layoutIfNeeded()
    root.search.layoutIfNeeded()
    return root
  }

  func testSearchRowAndKeysFitInsideTheKeyboardInEveryStyle() throws {
    for (name, style, width) in styles() {
      let root = searchRoot(style, width: width, query: "heart", count: values.count)
      XCTAssertEqual(root.bounds.height, style.totalHeight, "Search must not grow the keyboard")
      XCTAssertTrue(root.bar.isHidden)
      XCTAssertFalse(root.search.isHidden)
      XCTAssertFalse(root.keys.isHidden)
      XCTAssertEqual(root.search.frame, CGRect(x: 0, y: 0, width: width, height: style.barHeight))
      let row = root.search
      for view in row.subviews where !view.isHidden {
        XCTAssertTrue(row.bounds.contains(view.frame), "\(name): \(view.accessibilityIdentifier ?? "\(type(of: view))") leaves the row")
      }
      let field = try XCTUnwrap(row.subviews.first { $0.accessibilityIdentifier == "emoji-search-field" })
      let back = try XCTUnwrap(row.subviews.first { $0.accessibilityIdentifier == "emoji-search-back" })
      let strip = try XCTUnwrap(row.subviews.first { $0 is UIScrollView } as? UIScrollView)
      XCTAssertGreaterThanOrEqual(field.frame.height, 24, name)
      XCTAssertGreaterThanOrEqual(back.frame.width, 36, name)
      XCTAssertEqual(back.frame.height, style.barHeight, name)
      XCTAssertGreaterThan(strip.frame.width, 4 * 38, "\(name): too few results visible")
      XCTAssertGreaterThan(strip.contentSize.width, strip.frame.width, "\(name): 18 results should scroll")
      for cell in strip.subviews.compactMap({ $0 as? EmojiResultControl }) {
        XCTAssertEqual(cell.frame.height, strip.bounds.height)
        XCTAssertGreaterThanOrEqual(cell.frame.width, 38)
      }
      // Hit testing reaches the field's row controls and every key.
      XCTAssertTrue(root.hitTest(back.convert(CGPoint(x: back.bounds.midX, y: back.bounds.midY), to: root), with: nil) === back)
      let firstCell = strip.subviews.compactMap { $0 as? EmojiResultControl }.first!
      XCTAssertTrue(root.hitTest(firstCell.convert(CGPoint(x: firstCell.bounds.midX, y: firstCell.bounds.midY - 4), to: root), with: nil) === firstCell)
      for view in root.keys.keyViews {
        XCTAssertTrue(root.keys.bounds.contains(view.frame), "\(name): \(view.key.identifier) clipped")
        let center = root.keys.convert(CGPoint(x: view.frame.midX, y: view.frame.midY), to: root)
        XCTAssertTrue(root.hitTest(center, with: nil) === root.keys)
        XCTAssertEqual(root.keys.keyViews[root.keys.keyIndex(at: CGPoint(x: view.frame.midX, y: view.frame.midY))!].key, view.key)
      }
      save(root, name: "emoji-search-\(name)")
    }
  }

  func testFieldShowsTheQueryAndAnnouncesIt() throws {
    let root = searchRoot(KeyboardStyle(modern: true, dark: false, landscape: false), width: 393, query: "", count: 3)
    let field = try XCTUnwrap(root.search.subviews.first { $0.accessibilityIdentifier == "emoji-search-field" })
    XCTAssertEqual(field.accessibilityLabel, "Search emoji")
    XCTAssertTrue(field.accessibilityTraits.contains(.searchField))
    XCTAssertNil(field.accessibilityValue)
    let placeholder = try XCTUnwrap(field.subviews.compactMap { $0 as? UILabel }.first)
    XCTAssertEqual(placeholder.text, "Search Emoji")
    root.search.show(query: "red heart", results: results(2))
    XCTAssertEqual(field.accessibilityValue, "red heart")
    XCTAssertEqual(placeholder.text, "red heart")
    let back = try XCTUnwrap(root.search.subviews.first { $0.accessibilityIdentifier == "emoji-search-back" })
    XCTAssertEqual(back.accessibilityLabel, "Back to emoji")
    let strip = try XCTUnwrap(root.search.subviews.first { $0 is UIScrollView })
    let cells = strip.subviews.compactMap { $0 as? EmojiResultControl }
    XCTAssertEqual(cells.map(\.accessibilityLabel), ["emoji 0", "emoji 1"])
    XCTAssertEqual(cells.map(\.accessibilityIdentifier), ["emoji-result-😀", "emoji-result-😃"])
    XCTAssertTrue(cells.allSatisfy { $0.isAccessibilityElement })
    // Long queries keep their end in view.
    root.search.show(query: String(repeating: "smiling face ", count: 3), results: results(1))
    root.search.layoutIfNeeded()
    XCTAssertLessThanOrEqual(field.frame.width, (393 * 0.46).rounded())
    XCTAssertEqual(placeholder.lineBreakMode, .byTruncatingHead)
  }

  func testNoMatchesSayWhyAndAnEmptyQueryDoesNot() throws {
    let root = searchRoot(KeyboardStyle(modern: true, dark: false, landscape: false), width: 393, query: "xqzq", count: 0)
    let empty = try XCTUnwrap(root.search.subviews.compactMap { $0 as? UILabel }.first { $0.accessibilityIdentifier == "emoji-search-empty" })
    XCTAssertFalse(empty.isHidden)
    XCTAssertEqual(empty.text, "No emoji found")
    root.search.show(query: "", results: [])
    XCTAssertTrue(empty.isHidden)
    root.search.show(query: "pizza", results: results(1))
    XCTAssertTrue(empty.isHidden)
  }

  func testSearchKeysAreQWERTYWithAWayOut() {
    let root = searchRoot(KeyboardStyle(modern: true, dark: false, landscape: false), width: 393, query: "", count: 1)
    let identifiers = root.keys.keyViews.map(\.key.identifier)
    for identifier in ["key-q", "key-p", "key-a", "key-l", "key-z", "key-m", "key-shift", "key-delete", "key-letters", "key-emoji", "key-space"] {
      XCTAssertTrue(identifiers.contains(identifier), identifier)
    }
    XCTAssertFalse(identifiers.contains("key-return"))
    XCTAssertFalse(identifiers.contains("key-numbers"))
    // The back button keeps its lower edge; tapping it must not type q.
    let q = root.keys.keyViews.first { $0.key.identifier == "key-q" }!
    let point = CGPoint(x: root.keys.convert(q.frame, to: root).midX, y: root.search.frame.maxY - 3)
    let back = root.search.subviews.first { $0.accessibilityIdentifier == "emoji-search-back" }!
    XCTAssertTrue(root.hitTest(point, with: nil) === back)
  }

  private func save(_ view: UIView, name: String) {
    let image = UIGraphicsImageRenderer(bounds: view.bounds).image { view.layer.render(in: $0.cgContext) }
    let attachment = XCTAttachment(image: image)
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
    if let directory = ProcessInfo.processInfo.environment["PK_SCREENSHOT_DIR"] {
      try? image.pngData()?.write(to: URL(fileURLWithPath: directory).appendingPathComponent("\(name).png"))
    }
  }
}
