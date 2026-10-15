import XCTest
import UIKit
@testable import KeyboardUI

/// Docked one-handed layouts: frames, routing, and the geometry the tap model
/// and swipe decoder read. Drives UIKit's touch callbacks directly.
@MainActor
final class OneHandedLayoutTests: XCTestCase {
  private func letters() -> KeyboardLayout {
    KeyboardLayout.make(page: .letters, traits: InputTraits(), needsGlobe: false, digitHints: false)
  }

  private func makeRoot(width: CGFloat = 393, landscape: Bool = false, inset: Bool = false, dark: Bool = false, mode: OneHandedMode) -> KeyboardRootView {
    let style = KeyboardStyle(modern: true, dark: dark, landscape: landscape, inset: inset)
    let root = KeyboardRootView(style: style, layout: letters())
    root.frame = CGRect(x: 0, y: 0, width: width, height: style.totalHeight)
    root.paintsBackground = true
    root.oneHanded = mode
    root.layoutIfNeeded()
    return root
  }

  private func frame(_ identifier: String, in root: KeyboardRootView) -> CGRect {
    root.keys.keyViews.first { $0.key.identifier == identifier }!.frame
  }

  private func normalizedCenters(_ keys: KeysView) -> [Character: CGPoint] {
    keys.letterCenters.mapValues { CGPoint(x: $0.x / keys.pitch.width, y: $0.y / keys.pitch.height) }
  }

  func testDockedLayoutsNarrowTheBarAndKeysAgainstOneEdge() {
    for width in [375, 393, 402, 440] as [CGFloat] {
      let expected = CGFloat(OneHandedMode.right.keysWidth(in: Double(width)))
      let right = makeRoot(width: width, mode: .right)
      XCTAssertEqual(right.keys.frame.width, expected)
      XCTAssertEqual(right.keys.frame.maxX, width)
      XCTAssertEqual(right.bar.frame.minX, right.keys.frame.minX)
      XCTAssertEqual(right.bar.frame.width, expected)
      XCTAssertFalse(right.sidePanel.isHidden)
      XCTAssertEqual(right.sidePanel.frame, CGRect(x: 0, y: 0, width: width - expected, height: right.bounds.height))
      let left = makeRoot(width: width, mode: .left)
      XCTAssertEqual(left.keys.frame.minX, 0)
      XCTAssertEqual(left.keys.frame.width, expected)
      XCTAssertEqual(left.sidePanel.frame.minX, expected)
      XCTAssertEqual(left.sidePanel.frame.maxX, width)
      // The height and the caps' height stay; letters stay about 26 pt wide.
      XCTAssertEqual(right.bounds.height, right.style.totalHeight)
      XCTAssertEqual(frame("key-q", in: right).height, right.style.keyHeight)
      XCTAssertGreaterThanOrEqual(frame("key-q", in: right).width, 25.5, "\(width)")
      XCTAssertGreaterThanOrEqual(frame("key-p", in: left).width, 25.5, "\(width)")
      // The bottom row keeps every key inside the docked grid.
      for identifier in ["key-shift", "key-delete", "key-numbers", "key-emoji", "key-space", "key-return"] {
        XCTAssertTrue(right.keys.bounds.contains(frame(identifier, in: right)), "\(identifier) clipped at \(width)")
        XCTAssertTrue(left.keys.bounds.contains(frame(identifier, in: left)), "\(identifier) clipped at \(width)")
      }
    }
  }

  func testDockedGeometryNormalizesToTheFullWidthGeometry() {
    let full = makeRoot(mode: .off)
    let reference = normalizedCenters(full.keys)
    XCTAssertEqual(reference.count, 26)
    for mode in [OneHandedMode.left, .right] {
      let docked = makeRoot(mode: mode)
      XCTAssertLessThan(docked.keys.pitch.width, full.keys.pitch.width)
      XCTAssertEqual(docked.keys.pitch.height, full.keys.pitch.height)
      let centers = normalizedCenters(docked.keys)
      for (letter, point) in reference {
        // The side margin is fixed in points, so it is a slightly larger share
        // of a narrower pitch. Under 0.05 pitch keeps every key well apart.
        XCTAssertEqual(centers[letter]!.x, point.x, accuracy: 0.05, "\(letter) \(mode)")
        XCTAssertEqual(centers[letter]!.y, point.y, accuracy: 0.0001, "\(letter) \(mode)")
      }
      // Neighbors stay one pitch apart.
      XCTAssertEqual(centers["w"]!.x - centers["q"]!.x, 1, accuracy: 0.0001)
      XCTAssertEqual(centers["s"]!.x - centers["a"]!.x, 1, accuracy: 0.0001)
    }
  }

  func testChangingSidesAndExpandingRefreshTheSpatialModels() {
    let root = makeRoot(mode: .off)
    let recorder = Recorder()
    root.keys.delegate = recorder
    let fullWidth = root.keys.frame.width
    root.oneHanded = .right
    XCTAssertEqual(recorder.layouts, 1, "Narrowing must refresh the geometry")
    XCTAssertLessThan(root.keys.frame.width, fullWidth)
    let docked = normalizedCenters(root.keys)
    root.oneHanded = .left
    XCTAssertEqual(root.keys.frame.minX, 0)
    XCTAssertEqual(normalizedCenters(root.keys), docked, "Changing sides keeps the same local geometry")
    root.oneHanded = .off
    XCTAssertEqual(recorder.layouts, 2, "Expanding must refresh the geometry")
    XCTAssertEqual(root.keys.frame.width, fullWidth)
    XCTAssertTrue(root.sidePanel.isHidden)
  }

  func testSidePanelKeepsItsStripAndKeysKeepTheirs() {
    for mode in [OneHandedMode.left, .right] {
      let root = makeRoot(mode: mode)
      let panel = root.sidePanel.frame
      for y in stride(from: CGFloat(0), to: root.bounds.maxY, by: 4) {
        for x in stride(from: panel.minX, to: panel.maxX, by: 4) {
          let target = root.hitTest(CGPoint(x: x, y: y), with: nil)
          XCTAssertFalse(target === root.keys || target === root.bar, "Side panel point \(x),\(y) typed")
        }
      }
      for y in stride(from: root.keys.frame.minY, to: root.bounds.maxY, by: 3) {
        for x in stride(from: root.keys.frame.minX, to: root.keys.frame.maxX, by: 3) {
          XCTAssertTrue(root.hitTest(CGPoint(x: x, y: y), with: nil) === root.keys, "Unrouted docked gap at \(x),\(y)")
        }
      }
      for identifier in ["one-handed-expand", "one-handed-move"] {
        let button = root.sidePanel.subviews.first { $0.accessibilityIdentifier == identifier }!
        let center = button.convert(CGPoint(x: button.bounds.midX, y: button.bounds.midY), to: root)
        XCTAssertTrue(root.hitTest(center, with: nil) === button)
        XCTAssertGreaterThanOrEqual(button.bounds.width, 40)
        XCTAssertGreaterThanOrEqual(button.bounds.height, 44)
      }
      let move = root.sidePanel.subviews.first { $0.accessibilityIdentifier == "one-handed-move" }!
      XCTAssertEqual(move.accessibilityLabel, mode == .right ? "Move keyboard left" : "Move keyboard right")
      XCTAssertEqual(root.sidePanel.subviews.first { $0.accessibilityIdentifier == "one-handed-expand" }?.accessibilityLabel, "Full width keyboard")
      save(root, name: "one-handed-\(mode.rawValue)-light")
      save(makeRoot(dark: true, mode: mode), name: "one-handed-\(mode.rawValue)-dark")
    }
  }

  func testLandscapeAndOtherPanelsUseTheFullWidth() {
    let landscape = makeRoot(width: 852, landscape: true, mode: .right)
    XCTAssertFalse(landscape.canDock)
    XCTAssertEqual(landscape.keys.frame.width, 852)
    XCTAssertTrue(landscape.sidePanel.isHidden)
    let root = makeRoot(mode: .right)
    XCTAssertTrue(root.canDock)
    root.mode = .dictation
    root.layoutIfNeeded()
    XCTAssertTrue(root.sidePanel.isHidden)
    XCTAssertEqual(root.dictation.frame, root.bounds)
    root.mode = .emojiSearch
    root.layoutIfNeeded()
    XCTAssertFalse(root.sidePanel.isHidden)
    XCTAssertEqual(root.search.frame.minX, root.keys.frame.minX)
    XCTAssertEqual(root.search.frame.width, root.keys.frame.width)
  }

  func testTapsAtEveryDockedLetterCenterTypeThatLetter() {
    for mode in [OneHandedMode.left, .right] {
      let root = makeRoot(mode: mode)
      let recorder = Recorder()
      root.keys.delegate = recorder
      for view in root.keys.keyViews where view.key.isCharacter {
        let contact = Contact(point: CGPoint(x: view.frame.midX, y: view.frame.midY))
        root.keys.touchesBegan([contact], with: nil)
        root.keys.touchesEnded([contact], with: nil)
      }
      XCTAssertEqual(recorder.activations, root.keys.keyViews.filter(\.key.isCharacter).map(\.key.identifier))
      // Boundary taps between neighbors keep resolving to the nearer cap.
      let f = frame("key-f", in: root), g = frame("key-g", in: root)
      let near = Contact(point: CGPoint(x: (f.maxX + g.minX) / 2 - 1, y: f.midY))
      root.keys.touchesBegan([near], with: nil)
      root.keys.touchesEnded([near], with: nil)
      XCTAssertEqual(recorder.activations.last, "key-f")
    }
  }

  func testDockedSwipesReachTheDecoderInTheSameUnits() {
    var paths: [OneHandedMode: [CGPoint]] = [:]
    for mode in [OneHandedMode.off, .left, .right] {
      let root = makeRoot(mode: mode)
      let recorder = Recorder()
      root.keys.delegate = recorder
      let points = "hello".map { letter -> CGPoint in
        let f = frame("key-\(letter)", in: root)
        return CGPoint(x: f.midX, y: f.midY)
      }
      let contact = Contact(point: points[0])
      root.keys.touchesBegan([contact], with: nil)
      for point in points.dropFirst() {
        contact.point = point
        root.keys.touchesMoved([contact], with: nil)
      }
      root.keys.touchesEnded([contact], with: nil)
      XCTAssertEqual(recorder.glidePaths.count, 1, "\(mode)")
      paths[mode] = recorder.glidePaths[0].map { CGPoint(x: $0.x / root.keys.pitch.width, y: $0.y / root.keys.pitch.height) }
    }
    for mode in [OneHandedMode.left, .right] {
      XCTAssertEqual(paths[mode]!.count, paths[.off]!.count)
      for (docked, full) in zip(paths[mode]!, paths[.off]!) {
        XCTAssertEqual(docked.x, full.x, accuracy: 0.05)
        XCTAssertEqual(docked.y, full.y, accuracy: 0.0001)
      }
    }
  }

  func testControllerGeometryAndNormalizationFollowTheDockedKeys() throws {
    let host = Host()
    let controller = KeyboardController(host: host)
    let root = controller.rootView
    root.frame = CGRect(x: 0, y: 0, width: 393, height: root.style.totalHeight)
    root.layoutIfNeeded()
    let full = try XCTUnwrap(controller.letterGeometry)
    root.oneHanded = .right
    let docked = try XCTUnwrap(controller.letterGeometry)
    for byte in UInt8(97)...UInt8(122) {
      XCTAssertEqual(docked.center(byte)!.x, full.center(byte)!.x, accuracy: 0.05)
      XCTAssertEqual(docked.center(byte)!.y, full.center(byte)!.y, accuracy: 0.0001)
    }
    // A touch at a docked cap's center normalizes to that letter's center.
    let h = root.keys.keyViews.first { $0.key.identifier == "key-h" }!.frame
    let point = controller.normalized(CGPoint(x: h.midX, y: h.midY))
    XCTAssertEqual(docked.nearestLetter(to: point), UInt8(ascii: "h"))
    XCTAssertEqual(point.x, docked.center(UInt8(ascii: "h"))!.x, accuracy: 0.0001)
  }

  func testEmojiKeyMenuPicksALayoutOnlyWhenReleasedOnIt() {
    let root = makeRoot(mode: .off)
    let recorder = Recorder()
    recorder.oneHanded = .off
    root.keys.delegate = recorder
    let emoji = frame("key-emoji", in: root)
    var saved = false
    func hold(movingBy dx: CGFloat) {
      let contact = Contact(point: CGPoint(x: emoji.midX, y: emoji.midY))
      root.keys.touchesBegan([contact], with: nil)
      RunLoop.main.run(until: Date().addingTimeInterval(0.6))
      contact.point.x += dx
      root.keys.touchesMoved([contact], with: nil)
      if !saved, dx > 0 {
        saved = true
        save(root, name: "one-handed-menu")
      }
      root.keys.touchesEnded([contact], with: nil)
    }
    hold(movingBy: 0)
    XCTAssertEqual(recorder.choices, [.off], "Releasing in place keeps the current layout")
    XCTAssertFalse(recorder.activations.contains("key-emoji"), "A held emoji key doesn't open the picker")
    let cell = max(emoji.width, 44)
    hold(movingBy: cell)
    XCTAssertEqual(recorder.choices.last, .right)
    hold(movingBy: -cell)
    XCTAssertEqual(recorder.choices.last, .left)
    hold(movingBy: cell * 6)
    XCTAssertEqual(recorder.choices.count, 3, "Releasing well beside the menu changes nothing")
    // Where docking is unavailable, holding is an ordinary press.
    recorder.oneHanded = nil
    hold(movingBy: 0)
    XCTAssertEqual(recorder.activations.last, "key-emoji")
    // A quick tap still opens the picker.
    recorder.oneHanded = .off
    let tap = Contact(point: CGPoint(x: emoji.midX, y: emoji.midY))
    root.keys.touchesBegan([tap], with: nil)
    root.keys.touchesEnded([tap], with: nil)
    XCTAssertEqual(recorder.activations.filter { $0 == "key-emoji" }.count, 2)
  }

  func testEmojiKeyOffersLayoutsToVoiceOver() throws {
    let root = makeRoot(mode: .right)
    let recorder = Recorder()
    recorder.oneHanded = .right
    root.keys.delegate = recorder
    let key = try XCTUnwrap(root.keys.keyViews.first { $0.key.action == .emoji })
    let actions = try XCTUnwrap(key.accessibilityCustomActions)
    XCTAssertEqual(actions.map(\.name), ["Keyboard docked left", "Full width keyboard"])
    _ = actions[1].actionHandler?(actions[1])
    XCTAssertEqual(recorder.choices, [.off])
    recorder.oneHanded = nil
    XCTAssertNil(key.accessibilityCustomActions)
    XCTAssertNil(root.keys.keyViews.first { $0.key.identifier == "key-q" }?.accessibilityCustomActions)
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

  private final class Contact: UITouch {
    var point: CGPoint
    init(point: CGPoint) {
      self.point = point
      super.init()
    }
    override func location(in view: UIView?) -> CGPoint { point }
    override var timestamp: TimeInterval { ProcessInfo.processInfo.systemUptime }
  }

  private final class Recorder: KeysViewDelegate {
    var events: [String] = []
    var glidePaths: [[CGPoint]] = []
    var layouts = 0
    var choices: [OneHandedMode] = []
    var oneHanded: OneHandedMode?
    var activations: [String] { events.filter { $0.hasPrefix("activate:") }.map { String($0.dropFirst(9)) } }
    var keysViewAllowsGlide: Bool { true }
    var keysViewShowsPopups: Bool { false }
    var keysViewOneHandedMode: OneHandedMode? { oneHanded }
    func keysView(_ view: KeysView, chooseOneHanded mode: OneHandedMode) { choices.append(mode) }
    func keysView(_ view: KeysView, touchDown key: Key) {}
    func keysView(_ view: KeysView, activate key: Key, at point: CGPoint) { events.append("activate:\(key.identifier)") }
    func keysView(_ view: KeysView, glide points: [CGPoint], times: [TimeInterval], start: Key) { glidePaths.append(points) }
    func keysViewShiftUp(_ view: KeysView) {}
    func keysView(_ view: KeysView, insertAlternate text: String, for key: Key) {}
    func keysViewRepeatDelete(_ view: KeysView, wholeWord: Bool) {}
    func keysView(_ view: KeysView, moveCursor offset: Int) {}
    func keysView(_ view: KeysView, inputModeListWith event: UIEvent) {}
    func keysViewFinishedPageSlide(_ view: KeysView) {}
    func keysViewDidLayout(_ view: KeysView) { layouts += 1 }
  }

  private final class Document: TextDocument {
    var text = ""
    var documentContextBeforeInput: String? { text }
    var documentContextAfterInput: String? { "" }
    var selectedText: String? { nil }
    var hasText: Bool { !text.isEmpty }
    func insertText(_ inserted: String) { text += inserted }
    func deleteBackward() { if !text.isEmpty { text.removeLast() } }
  }

  private final class Host: KeyboardHost {
    let textDocument = Document()
    var document: TextDocument { textDocument }
    var inputTraits: InputTraits { InputTraits() }
    var needsInputModeSwitchKey: Bool { false }
    var hasFullAccess: Bool { false }
    var isInsideApp: Bool { true }
    func advanceToNextInputMode() {}
    func handleInputModeList(from view: UIView, with event: UIEvent) {}
    func adjustTextPosition(byCharacterOffset offset: Int) {}
    func openApp(_ url: URL) {}
  }
}
