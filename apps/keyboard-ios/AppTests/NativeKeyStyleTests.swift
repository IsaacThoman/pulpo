import XCTest
import UIKit
@testable import KeyboardUI

@MainActor
final class NativeKeyStyleTests: XCTestCase {
  func testActionReturnKeepsWhiteTextAndBlueFillDuringPress() throws {
    for dark in [false, true] {
      var failure: Error?
      UITraitCollection(userInterfaceStyle: dark ? .dark : .light).performAsCurrent {
        do {
          let style = KeyboardStyle(modern: true, dark: dark, landscape: false)
          let key = KeyView(key: Key(action: .returnKey, label: "search", style: .returnKey), style: style)
          let label = try XCTUnwrap(key.subviews.compactMap { $0 as? UILabel }.first { $0.text == "search" })
          let normal = try XCTUnwrap(key.layer.sublayers?.first?.backgroundColor)
          key.isPressed = true
          XCTAssertEqual(label.textColor, .white, "A pressed action must keep its readable foreground")
          let pressed = UIColor(cgColor: try XCTUnwrap(key.layer.sublayers?.first?.backgroundColor))
          var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
          XCTAssertTrue(pressed.getRed(&red, green: &green, blue: &blue, alpha: &alpha))
          XCTAssertGreaterThan(blue, green)
          XCTAssertGreaterThan(green, red)
          XCTAssertNotEqual(key.layer.sublayers?.first?.backgroundColor, normal)
          key.isPressed = false
          XCTAssertEqual(key.layer.sublayers?.first?.backgroundColor, normal)
          key.isEnabled = false
          XCTAssertEqual(label.textColor, style.secondaryLabel)
          XCTAssertTrue(key.accessibilityTraits.contains(.notEnabled))
        } catch { failure = error }
      }
      if let failure { throw failure }
    }
  }

  func testDeletePressChangesSymbolAndRestoresItWithoutChangingMeaning() throws {
    let key = KeyView(key: Key(action: .delete, label: "delete", style: .function),
                      style: KeyboardStyle(modern: true, dark: false, landscape: false))
    let image = try XCTUnwrap(key.subviews.compactMap { $0 as? UIImageView }.first)
    let normal = try XCTUnwrap(image.image?.pngData())
    key.isPressed = true
    XCTAssertNotEqual(image.image?.pngData(), normal)
    XCTAssertEqual(key.accessibilityLabel, "delete")
    key.isPressed = false
    XCTAssertEqual(image.image?.pngData(), normal)
  }

  func testTrackpadFadesCapsAndRestoresTheCurrentPressState() throws {
    let style = KeyboardStyle(modern: true, dark: false, landscape: false)
    let key = KeyView(key: Key(action: .space, label: "space", flexible: true), style: style)
    let face = try XCTUnwrap(key.layer.sublayers?.first)
    let idle = face.backgroundColor
    key.isPressed = true
    let pressed = face.backgroundColor
    key.isDimmed = true
    XCTAssertEqual(face.opacity, 0.5)
    XCTAssertEqual(face.backgroundColor, idle)
    XCTAssertTrue(key.subviews.allSatisfy { $0.alpha == 0 })
    key.isDimmed = false
    XCTAssertEqual(face.opacity, 1)
    XCTAssertEqual(face.backgroundColor, pressed)
    XCTAssertTrue(key.subviews.allSatisfy { $0.alpha == 1 })
    key.isPressed = false
    XCTAssertEqual(face.backgroundColor, idle)
  }
}
