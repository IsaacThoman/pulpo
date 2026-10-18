import UIKit
import XCTest
@testable import KeyboardUI

/// Hosted native field/controller coverage. Does not install an extension or
/// demonstrate the system keyboard menu or spoken VoiceOver behavior.
@MainActor
final class NumericKeyboardControllerTests: XCTestCase {
  private final class Host: KeyboardHost, @preconcurrency TextDocument {
    let field = UITextField()
    var document: TextDocument { self }
    var inputTraits: InputTraits { InputTraits(field) }
    var needsInputModeSwitchKey = true
    var hasFullAccess: Bool { false }
    var isInsideApp: Bool { false }
    var advances = 0
    var events: [UIEvent] = []
    var sources: [UIView] = []
    var documentContextBeforeInput: String? { field.text ?? "" }
    var documentContextAfterInput: String? { "" }
    var selectedText: String? { nil }
    var hasText: Bool { field.hasText }
    func insertText(_ text: String) { field.insertText(text) }
    func deleteBackward() { field.deleteBackward() }
    func advanceToNextInputMode() { advances += 1 }
    func handleInputModeList(from view: UIView, with event: UIEvent) { sources.append(view); events.append(event) }
    func adjustTextPosition(byCharacterOffset offset: Int) {}
    func openApp(_ url: URL) {}
  }

  private final class Contact: UITouch {
    let point: CGPoint
    init(_ point: CGPoint) { self.point = point; super.init() }
    override func location(in view: UIView?) -> CGPoint { point }
  }

  private func tap(_ view: KeyView, in keys: KeysView, event: UIEvent? = nil) {
    let contact = Contact(CGPoint(x: view.frame.midX, y: view.frame.midY))
    keys.touchesBegan([contact], with: event)
    keys.touchesEnded([contact], with: event)
  }

  func testDecimalFieldTypesLiterallyAndGlobePreservesDocument() throws {
    let host = Host()
    host.field.keyboardType = .decimalPad
    let controller = KeyboardController(host: host, dictationBridge: nil)
    let root = controller.rootView
    root.frame = CGRect(x: 0, y: 0, width: 320, height: controller.preferredHeight)
    root.layoutIfNeeded()
    let separator = Locale.autoupdatingCurrent.decimalSeparator ?? "."
    for text in ["0", separator, "8", "6"] {
      let key = try XCTUnwrap(root.keys.keyViews.first { $0.key.action == .character(text) })
      tap(key, in: root.keys)
      controller.documentDidChange()
    }
    tap(try XCTUnwrap(root.keys.keyViews.first { $0.key.action == .delete }), in: root.keys)
    XCTAssertEqual(host.field.text, "0\(separator)8")
    let globe = try XCTUnwrap(root.keys.keyViews.first { $0.key.action == .nextKeyboard })
    XCTAssertEqual(globe.accessibilityLabel, "next keyboard")
    XCTAssertTrue(globe.isAccessibilityElement)
    let event = UIEvent()
    tap(globe, in: root.keys, event: event)
    XCTAssertEqual(host.events.count, 2)
    XCTAssertTrue(host.events.allSatisfy { $0 === event })
    XCTAssertTrue(host.sources.allSatisfy { $0 === root.keys })
    XCTAssertTrue(globe.accessibilityActivate())
    XCTAssertEqual(host.advances, 1)
    XCTAssertEqual(host.field.text, "0\(separator)8")
    XCTAssertFalse(controller.engine.policy.learns)
    host.needsInputModeSwitchKey = false
    controller.documentDidChange()
    XCTAssertFalse(root.keys.keyViews.contains { $0.key.action == .nextKeyboard })
    XCTAssertTrue(root.keys.keyViews.contains { $0.key.action == .character(separator) })
  }

  func testNumericTargetsFitCompactDockedLandscapeAndLargestAccessibilityText() throws {
    for category in [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge] {
      for width: CGFloat in [320, 375, 393, 852] {
        for mode in [OneHandedMode.off, .left, .right] {
          let host = Host()
          host.field.keyboardType = .decimalPad
          let controller = KeyboardController(host: host, dictationBridge: nil)
          let root = controller.rootView
          let vc = UIViewController()
          vc.traitOverrides.preferredContentSizeCategory = category
          let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 600))
          window.rootViewController = vc
          window.makeKeyAndVisible()
          vc.view.addSubview(root)
          root.frame = CGRect(x: 0, y: 0, width: width, height: controller.preferredHeight)
          controller.layoutChanged(dark: false)
          root.frame.size.height = controller.preferredHeight
          root.oneHanded = mode
          root.layoutIfNeeded()
          XCTAssertEqual(root.traitCollection.preferredContentSizeCategory, category)
          let bottom = Array(root.keys.keyViews.suffix(4))
          XCTAssertEqual(bottom.count, 4)
          for key in root.keys.keyViews {
            XCTAssertTrue(root.keys.bounds.contains(key.frame), "\(width) \(mode) \(key.key.identifier)")
            let point = CGPoint(x: key.frame.midX, y: key.frame.midY)
            XCTAssertEqual(root.keys.keyIndex(at: point).map { root.keys.keyViews[$0].key.identifier }, key.key.identifier)
            XCTAssertTrue(root.hitTest(root.keys.convert(point, to: root), with: nil) === root.keys)
          }
          for key in bottom {
            XCTAssertGreaterThanOrEqual(key.frame.width, 44)
            // Conservative guaranteed target: full cap width plus 1pt above.
            // Existing landscape caps remain 32pt; no 44pt landscape claim.
            let top = max(0, key.frame.minY - 1)
            let target = CGRect(x: key.frame.minX, y: top, width: key.frame.width, height: key.frame.maxY - top)
            if width <= 500 { XCTAssertGreaterThanOrEqual(target.height, 44) }
            for x in [target.minX + 0.5, target.midX, target.maxX - 0.5] {
              for y in [target.minY + 0.5, target.midY, target.maxY - 0.5] {
                let point = CGPoint(x: x, y: y)
                XCTAssertEqual(root.keys.keyIndex(at: point).map { root.keys.keyViews[$0].key.identifier }, key.key.identifier)
              }
            }
          }
          window.isHidden = true
        }
      }
    }
  }
}
