import XCTest

@MainActor
final class EditingUXR17Tests: PreviewTypingTestCase {
  private func writeObservations(_ observations: Any, name: String) throws {
    let requested = ProcessInfo.processInfo.environment["PK_R17_REPORT"]
    let directory = requested.map { URL(fileURLWithPath: $0).deletingLastPathComponent() }
      ?? FileManager.default.temporaryDirectory.appendingPathComponent("pulpo-r17")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try JSONSerialization.data(withJSONObject: observations, options: [.prettyPrinted, .sortedKeys])
      .write(to: directory.appendingPathComponent(name))
  }

  func testBlindExploration() throws {
    var observations: [[String: String]] = []
    func capture(_ id: String) {
      observations.append(["id": id, "document": app.previewText, "ui": app.debugDescription, "selection": "unavailable via XCTest accessibility"])
      snapshot("r17-\(id)")
      try? writeObservations(observations, name: "exploration.json")
    }
    app.typeOnPreview("hello\nworld")
    capture("en-before-kind")
    app.buttons["Email"].tap()
    app.buttons["Text"].tap()
    app.typeOnPreview("\nok")
    capture("en-field-roundtrip")
    clearText()
    app.chooseTypingLanguage("Español")
    app.typeOnPreview("hola familia")
    app.textViews["preview-text"].press(forDuration: 1.1)
    capture("es-edit-menu")
    if app.menuItems["Select All"].exists { app.menuItems["Select All"].tap() }
    else if app.buttons["Select All"].exists { app.buttons["Select All"].tap() }
    capture("es-selected")
    app.chooseTypingLanguage("English + Español")
    app.typeOnPreview("sol")
    capture("es-selection-language")
    clearText()
    app.typeOnPreview("hola team ")
    app.key("key-emoji").tap()
    XCTAssertTrue(app.key("emoji-search-open").waitForExistence(timeout: 5))
    app.key("emoji-search-open").tap()
    app.typeOnPreview("red heart")
    capture("bi-query")
    app.key("emoji-search-back").tap()
    capture("bi-picker")
    app.buttons["emoji-abc"].tap()
    app.typeOnPreview("ok")
    capture("bi-search-roundtrip")
    clearText()
    app.chooseTypingLanguage("English")
    app.typeOnPreview("hello")
    app.key("key-emoji").tap()
    app.key("emoji-search-open").tap()
    app.typeOnPreview("pizza")
    app.navigationBars.buttons["Clear"].tap()
    capture("en-clear-search")
    if app.key("emoji-search-back").exists { app.key("emoji-search-back").tap() }
    if app.buttons["emoji-abc"].exists { app.buttons["emoji-abc"].tap() }
    else if app.key("key-letters").exists { app.key("key-letters").tap() }
    app.typeOnPreview("hi")
    capture("en-clear-search-typed")
    try writeObservations(observations, name: "exploration.json")
  }
  func testBlindAccessibilityExploration() throws {
    app.terminate()
    app.launchArguments = ["-PKPreview", "-PKResetLearning", "-PKResetSettings", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    app.launch()
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 8))
    app.chooseTypingLanguage("English + Español")
    app.typeOnPreview("hola team")
    snapshot("r17-accessibility-main")
    var observations = [["id":"accessibility-main", "document":app.previewText, "ui":app.debugDescription]]
    app.buttons["try-it-tips"].tap()
    snapshot("r17-accessibility-tips")
    observations.append(["id":"accessibility-tips", "document":app.previewText, "ui":app.debugDescription])
    try writeObservations(observations, name: "accessibility-exploration.json")
  }

  func testBlindCursorExploration() throws {
    var observations: [[String: Any]] = []
    for emoji in [false, true] {
      clearText()
      if emoji {
        app.chooseTypingLanguage("Español")
      }
      app.typeOnPreview("a")
      if emoji {
        app.key("key-emoji").tap()
        app.key("emoji-search-open").tap()
        app.typeOnPreview("pizza")
        app.key("emoji-result-🍕").tap()
        app.key("key-letters").tap()
      }
      app.typeOnPreview("b")
      let before = app.previewText
      let start = app.key("key-space").coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
      start.press(forDuration: 0.7, thenDragTo: start.withOffset(CGVector(dx: -24, dy: 0)))
      app.typeOnPreview("x")
      let raw = (app.textViews["preview-text"].value as? NSString) ?? ""
      let units = (0..<raw.length).map { raw.character(at: $0) }
      let uiUnits = Array(app.debugDescription.utf16)
      observations.append(["id":emoji ? "es-cursor-emoji" : "en-cursor-ascii", "before":before, "document":String(decoding: units, as: UTF16.self), "exactDocumentUTF16":units, "selection":"unavailable via AX", "ui":String(decoding: uiUnits, as: UTF16.self)])
      snapshot(emoji ? "r17-cursor-emoji" : "r17-cursor-ascii")
      try writeObservations(observations, name: "cursor-exploration.json")
    }
  }

}
