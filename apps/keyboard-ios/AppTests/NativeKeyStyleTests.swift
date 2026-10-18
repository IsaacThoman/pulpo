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

  func testEmojiKeyDrawsPulpoFaceInATintableCircle() throws {
    for dark in [false, true] {
      for bold in [false, true] {
        let style = KeyboardStyle(modern: true, dark: dark, landscape: false, bold: bold)
        let key = KeyView(key: Key(action: .emoji, label: "emoji", style: .function), style: style)
        let symbol = try XCTUnwrap(key.subviews.compactMap { $0 as? UIImageView }.first)
        let image = try XCTUnwrap(symbol.image)
        let circle = try XCTUnwrap(UIImage(systemName: "circle", withConfiguration: style.symbolConfiguration))
        XCTAssertFalse(symbol.isHidden)
        XCTAssertEqual(key.accessibilityLabel, "emoji")
        XCTAssertEqual(image.renderingMode, .alwaysTemplate, "The glyph must take the key's tint like a symbol")
        XCTAssertEqual(image.size, circle.size, "The glyph must sit where face.smiling did")

        let cgImage = try XCTUnwrap(image.cgImage)
        let width = cgImage.width, height = cgImage.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let context = try XCTUnwrap(CGContext(data: &pixels, width: width, height: height, bitsPerComponent: 8,
                                              bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
        let bounds = CGRect(origin: .zero, size: image.size).inset(by: image.alignmentRectInsets)
        let radius = min(bounds.width, bounds.height) / 2
        // Alpha at a point given in units of half the image, which the circle fills about 85% of, y down.
        func alpha(_ x: CGFloat, _ y: CGFloat) -> UInt8 {
          let column = Int((bounds.midX + x * radius) * image.scale), row = Int((bounds.midY + y * radius) * image.scale)
          return pixels[(row * width + column) * 4 + 3]
        }
        // A filled circle has the face cut out of it; a ring holds a solid face.
        let filled = alpha(0, 0) == 255
        let face: UInt8 = filled ? 0 : 255, background: UInt8 = filled ? 255 : 0
        XCTAssertEqual(alpha(-0.31, -0.19), face, "Left eye")
        XCTAssertEqual(alpha(0.27, -0.22), face, "Right eye")
        XCTAssertEqual(alpha(0, filled ? 0.58 : 0.48), face, "Smile")
        XCTAssertEqual(alpha(0, -0.25), background, "Between the eyes")
        XCTAssertEqual(alpha(0, 0.2), background, "Above the smile")
        XCTAssertEqual(alpha(0.82, 0), 255, "Edge of the circle")
        XCTAssertEqual(filled, dark, "A ring on light keys and a filled circle on dark keys, like face.smiling")
      }
    }
  }
}
