import XCTest

extension XCTestCase {
  /// Saves a screenshot as an attachment and, when `PK_SCREENSHOT_DIR` is set, as a PNG.
  @MainActor
  func snapshot(_ name: String) {
    let shot = XCUIScreen.main.screenshot()
    let attachment = XCTAttachment(screenshot: shot)
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
    if let directory = ProcessInfo.processInfo.environment["PK_SCREENSHOT_DIR"] {
      try? shot.pngRepresentation.write(to: URL(fileURLWithPath: directory).appendingPathComponent("\(name).png"))
    }
  }
}

@MainActor
extension XCUIApplication {
  /// The in-app keyboard preview's key with `identifier` (e.g. "key-a").
  func key(_ identifier: String) -> XCUIElement {
    descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  /// Types `text` on the in-app keyboard, letter by letter.
  func typeOnPreview(_ text: String) {
    for character in text {
      switch character {
      case " ": key("key-space").tap()
      case "\n": key("key-return").tap()
      default: key("key-\(String(character).lowercased())").tap()
      }
    }
  }

  var previewText: String {
    (textViews["preview-text"].value as? String) ?? ""
  }
}

/// Multi-point touch paths through XCTest's event synthesizer, for swipe typing.
/// XCUICoordinate only supports straight drags.
@MainActor
enum TouchPath {
  static func swipe(through points: [CGPoint], duration: TimeInterval = 0.6) throws {
    guard let pathClass = NSClassFromString("XCPointerEventPath") as? NSObject.Type,
          let recordClass = NSClassFromString("XCSynthesizedEventRecord") as? NSObject.Type,
          let first = points.first else { throw XCTSkip("Event synthesis is unavailable") }
    typealias InitPath = @convention(c) (AnyObject, Selector, CGPoint, Double) -> AnyObject
    typealias Move = @convention(c) (AnyObject, Selector, CGPoint, Double) -> Void
    typealias Lift = @convention(c) (AnyObject, Selector, Double) -> Void
    typealias InitRecord = @convention(c) (AnyObject, Selector, NSString, Int) -> AnyObject
    typealias Add = @convention(c) (AnyObject, Selector, AnyObject) -> Void
    typealias Synthesize = @convention(c) (AnyObject, Selector, UnsafeMutablePointer<NSError?>?) -> Bool

    let initPath = NSSelectorFromString("initForTouchAtPoint:offset:")
    let path = pathClass.perform(NSSelectorFromString("alloc"))!.takeUnretainedValue()
    let pathObject = unsafeBitCast(path.method(for: initPath), to: InitPath.self)(path, initPath, first, 0)
    let move = NSSelectorFromString("moveToPoint:atOffset:")
    let moveFunction = unsafeBitCast(pathObject.method(for: move), to: Move.self)
    // Interpolate so the keyboard sees a continuous finger.
    var samples: [CGPoint] = []
    for (a, b) in zip(points, points.dropFirst()) {
      let steps = max(2, Int(hypot(b.x - a.x, b.y - a.y) / 6))
      for step in 1...steps {
        let t = CGFloat(step) / CGFloat(steps)
        samples.append(CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t))
      }
    }
    for (index, point) in samples.enumerated() {
      moveFunction(pathObject, move, point, duration * Double(index + 1) / Double(samples.count))
    }
    let lift = NSSelectorFromString("liftUpAtOffset:")
    unsafeBitCast(pathObject.method(for: lift), to: Lift.self)(pathObject, lift, duration + 0.02)

    let initRecord = NSSelectorFromString("initWithName:interfaceOrientation:")
    let record = recordClass.perform(NSSelectorFromString("alloc"))!.takeUnretainedValue()
    let recordObject = unsafeBitCast(record.method(for: initRecord), to: InitRecord.self)(record, initRecord, "swipe" as NSString, 1)
    let add = NSSelectorFromString("addPointerEventPath:")
    unsafeBitCast(recordObject.method(for: add), to: Add.self)(recordObject, add, pathObject)
    let synthesize = NSSelectorFromString("synthesizeWithError:")
    var error: NSError?
    let ok = unsafeBitCast(recordObject.method(for: synthesize), to: Synthesize.self)(recordObject, synthesize, &error)
    if !ok { throw error ?? NSError(domain: "TouchPath", code: 1) }
  }
}
