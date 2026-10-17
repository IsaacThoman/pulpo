import XCTest
import UIKit
@testable import KeyboardUI

/// Long-press strips: which way they open, what they select by default, and
/// how the finger moves the selection.
@MainActor
final class AlternateStripTests: XCTestCase {
  private var keys: KeysView!
  private var host: UIView!

  override func setUp() async throws {
    let style = KeyboardStyle.current(dark: false, landscape: false, inset: false)
    keys = KeysView(layout: KeyboardLayout.make(page: .letters, traits: InputTraits(), needsGlobe: false, digitHints: false), style: style)
    keys.frame = CGRect(x: 0, y: 0, width: 393, height: style.totalHeight - style.barHeight)
    keys.layoutIfNeeded()
    host = UIView(frame: CGRect(x: 0, y: 0, width: 393, height: 300))
  }

  private func strip(_ options: [String], keyRect: CGRect) -> KeyPopupView {
    let popup = KeyPopupView(style: keys.style)
    host.addSubview(popup)
    popup.showAlternates(options, keyRect: keyRect, in: host.bounds, style: keys.style)
    return popup
  }

  private func frame(_ identifier: String) -> CGRect {
    // Lowered so the strip has headroom inside the test host.
    keys.keyViews.first { $0.key.identifier == identifier }!.frame.offsetBy(dx: 0, dy: 200)
  }

  func testRightSideStripIsMirroredWithTheBaseAboveTheKey() {
    let o = frame("key-o")
    let options = ["o", "ô", "ö", "ò", "ó", "œ", "ø", "ō", "õ"]
    let popup = strip(options, keyRect: o)
    XCTAssertEqual(popup.options, options.reversed())
    XCTAssertEqual(popup.selectedOption, "o", "Released in place, a long press types the base letter")
    popup.track(x: o.midX + 3)
    XCTAssertEqual(popup.selectedOption, "o")
    popup.track(x: o.midX - max(o.width, 30) * 1.05)
    XCTAssertEqual(popup.selectedOption, "ô", "Sliding toward the strip picks the next option")
  }

  func testLeftSideStripKeepsItsOrder() {
    let e = frame("key-e")
    let options = ["e", "è", "é", "ê"]
    let popup = strip(options, keyRect: e)
    XCTAssertEqual(popup.options, options)
    popup.track(x: e.midX)
    XCTAssertEqual(popup.selectedOption, "e")
    popup.track(x: e.midX + max(e.width, 30) * 1.05)
    XCTAssertEqual(popup.selectedOption, "è")
  }

  func testWideKeyStripStaysOnScreenAndDefaultsToTheKey() {
    // The URL keyboard's .com key, measured on an iPhone 17 Pro.
    let dotCom = CGRect(x: 237, y: 250, width: 59, height: 43)
    let options = [".com", ".net", ".org", ".edu", ".us", ".co"]
    let popup = strip(options, keyRect: dotCom)
    popup.track(x: dotCom.midX)
    XCTAssertEqual(popup.selectedOption, ".com")
    let labels = popup.subviews.compactMap { $0 as? UILabel }
    XCTAssertTrue(host.bounds.contains(labels.reduce(CGRect.null) { $0.union($1.frame) }))
    // The default sits over the key rather than wherever clamping pushed it.
    let base = labels.first { $0.text == ".com" }!.frame
    XCTAssertTrue(base.minX >= dotCom.minX - 12 && base.maxX <= dotCom.maxX + 12, "\(base) vs \(dotCom)")
    popup.track(x: dotCom.midX - base.width * 1.05)
    XCTAssertEqual(popup.selectedOption, ".net")
  }
}

/// The same strips end to end through the in-app keyboard.
final class AlternateStripTypingTests: PreviewTypingTestCase {
  func testLongPressOnARightSideLetterTypesItWhenReleasedInPlace() {
    for letter in ["o", "u", "i"] {
      clearText()
      app.key("key-\(letter)").press(forDuration: 0.8)
      waitForText(letter.uppercased())
    }
    clearText()
    let o = app.key("key-o")
    let start = o.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    start.press(forDuration: 0.8, thenDragTo: start.withOffset(CGVector(dx: -o.frame.width * 1.05, dy: -8)))
    waitForText("Ô")
  }

  func testDotComLongPressDefaultsToDotCom() {
    app.segmentedControls["field-kind"].buttons["Web"].tap()
    XCTAssertTrue(app.key("key-dotcom").waitForExistence(timeout: 3))
    app.key("key-dotcom").press(forDuration: 0.8)
    waitForText(".com")
  }
}
