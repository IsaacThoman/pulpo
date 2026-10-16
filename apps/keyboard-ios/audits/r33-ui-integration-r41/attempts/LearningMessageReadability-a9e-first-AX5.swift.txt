import XCTest

/// Inspect the real system message viewport and perform real native scrolling.
/// A multiline label's full AX frame can extend beyond its clipping scroll view.
@MainActor
func assertLearningMessageReadable(_ message: XCUIElement, in container: XCUIElement,
                                  action: XCUIElement, record: (String) throws -> Void) throws {
  XCTAssertTrue(message.exists)
  XCTAssertTrue(action.isHittable)
  try record("start")
  let scrolls = container.scrollViews.allElementsBoundByIndex.filter {
    $0.staticTexts.matching(NSPredicate(format: "label == %@", message.label)).firstMatch.exists
  }
  if let viewport = scrolls.min(by: { $0.frame.height < $1.frame.height }),
     message.frame.maxY > viewport.frame.maxY + 2 {
    XCTAssertGreaterThan(viewport.frame.height, 0)
    XCTAssertLessThanOrEqual(viewport.frame.maxY, action.frame.minY + 2)
    for _ in 0..<24 where message.frame.maxY > viewport.frame.maxY + 2 {
      let before = message.frame.maxY
      viewport.swipeUp()
      guard message.frame.height > 0 && message.frame.maxY < before - 0.5 else {
        XCTFail("Native message viewport did not scroll toward the complete copy")
        throw NSError(domain: "R41Readability", code: 1)
      }
    }
    XCTAssertLessThanOrEqual(message.frame.maxY, viewport.frame.maxY + 2,
                             "The complete shared-scope message must be reachable by native scrolling")
  } else {
    XCTAssertLessThanOrEqual(message.frame.maxY, action.frame.minY + 2)
  }
  XCTAssertTrue(action.isHittable)
  try record("end")
}
