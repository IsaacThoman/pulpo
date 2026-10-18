import XCTest

/// Post-freeze binding of the one qualifying sealed workflow. All other cases
/// retain their unavailable preconditions in heldout-binding.json; no substitutes.
@MainActor
final class HeldoutCompanionR24Tests: XCTestCase {
  func testSealedLanguageWorkflowOnce() throws {
    guard let input = ProcessInfo.processInfo.environment["PK_R24_HELDOUT"],
          let output = ProcessInfo.processInfo.environment["PK_R24_HELDOUT_REPORT"] else {
      throw XCTSkip("Requires the sealed R24 corpus and per-version output paths")
    }
    let suite = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: input))) as! [String: Any]
    let item = (suite["cases"] as! [[String: Any]]).first { $0["id"] as? String == "r24-heldout-02" }!
    let initial = (item["initial_documents"] as! [[String: Any]])[0]
    let expected = initial["text"] as! String
    let app = XCUIApplication()
    app.launchArguments = ["-PKPreview", "-PKResetSettings", "-PKResetLearning"]
    app.launch()
    var observations: [[String: Any]] = []
    func capture(_ stage: String, documentVisible: Bool) throws {
      let field = app.textViews["preview-text"]
      var row: [String: Any] = ["stage": stage, "ui": app.debugDescription,
        "selection": "unverified via XCTest AX; no inference from content or focus",
        "expectedDocument": expected, "expectedSelectionUTF16": initial["selection_utf16"]!,
        "viewport": "iPhone 17 402x874; authored smallest supported portrait viewport not executed",
        "voiceOver": "not enabled or driven"]
      if documentVisible, field.exists {
        row["document"] = app.previewText
        row["documentPassed"] = app.previewText == expected
      } else { row["document"] = NSNull(); row["documentStatus"] = "unobservable offscreen" }
      observations.append(row)
      try JSONSerialization.data(withJSONObject: observations, options: [.prettyPrinted, .sortedKeys])
        .write(to: URL(fileURLWithPath: output))
      snapshot("r24-heldout-02-\(stage)")
    }
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 8))
    let field = app.textViews["preview-text"]
    field.typeText(expected)
    try capture("fixture-text", documentVisible: true)
    guard app.previewText == expected else { XCTFail("Fixture text differs; remaining sealed stages unexecuted"); return }
    field.press(forDuration: 1.1)
    let selectAll = app.menuItems["Select All"].exists ? app.menuItems["Select All"] : app.buttons["Select All"]
    guard selectAll.waitForExistence(timeout: 3) else {
      try capture("selection-control-unavailable", documentVisible: true)
      XCTFail("Cannot bind authored full selection with available editor controls; remaining stages unexecuted")
      return
    }
    selectAll.tap()
    try capture("fixture-selected-unverified-range", documentVisible: true)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    try capture("open-settings", documentVisible: false)
    let language = app.key("typing-language")
    for _ in 0..<12 where !language.isHittable { app.swipeUp() }
    guard language.isHittable else { XCTFail("Sealed settings control unreachable; later stages unexecuted"); return }
    let initialValue = language.label + " " + String(describing: language.value)
    language.tap()
    app.buttons["Español"].firstMatch.tap()
    let chosenValue = language.label + " " + String(describing: language.value)
    observations.append(["stage": "chosen-language", "initialValue": initialValue, "chosenValue": chosenValue,
      "binding": "initial English; alternate Español", "selectedValueVisible": chosenValue.contains("Español")])
    try capture("choose-language", documentVisible: false)
    for _ in 0..<14 where !app.key("try-it").isHittable { app.swipeDown() }
    app.key("try-it").tap()
    field.tap()
    try capture("return-and-refocus", documentVisible: true)
    XCTAssertEqual(app.previewText, expected)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    for _ in 0..<12 where !language.isHittable { app.swipeUp() }
    let reopened = language.label + " " + String(describing: language.value)
    observations.append(["stage": "reopened-language", "value": reopened, "selectedValueVisible": reopened.contains("Español")])
    try capture("reopen-settings", documentVisible: false)
    XCTAssertTrue(reopened.contains("Español"))
  }
}
