import XCTest

/// Frozen settings-only contract. No editor, selection, account, network or device mutation actions.
@MainActor
final class SettingsUsabilityContractTests: XCTestCase {
  private struct Fixture: Decodable { let version: Int; let cases: [Scenario] }
  private struct Scenario: Decodable { let id: String; let intent: String; let actions: [Action] }
  private struct Action: Decodable {
    let op: String
    let target: String?
    let direction: String?
    let label: String?
    let contains: String?
    let title: String?
  }
  let app = XCUIApplication()

  func testFrozenSettingsContract() throws {
    let directory = URL(fileURLWithPath: "/tmp/pulpo-settings-usability-sweep")
    let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: directory.appendingPathComponent("revealed.json")))
    XCTAssertEqual(fixture.version, 1)
    var outcomes: [[String: Any]] = []
    for scenario in fixture.cases {
      app.terminate()
      app.launchArguments = ["-PKResetSettings"]
      app.launch()
      _ = app.navigationBars["Keyboard"].waitForExistence(timeout: 8)
      var commands: [[String: Any]] = []
      for (index, action) in scenario.actions.enumerated() {
        var passed = false
        var scrolls = 0
        var readback = ""
        func target() -> XCUIElement {
          app.descendants(matching: .any).matching(identifier: action.target ?? "").firstMatch
        }
        switch action.op {
        case "reach":
          for attempt in 0...30 {
            let element = target()
            if element.exists && element.isHittable && element.frame.minY >= 116 && element.frame.maxY <= 812 {
              passed = true; readback = element.label; break
            }
            if attempt < 30 {
              if element.exists && (element.frame.minY < 116 || element.frame.maxY > 812) {
                let delta = element.frame.minY < 116 ? min(300, 116 - element.frame.minY + 10) : -min(300, element.frame.maxY - 812 + 10)
                let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 394, dy: 450))
                start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: delta)))
              } else if action.direction == "down" { app.swipeDown() } else { app.swipeUp() }
              scrolls += 1
            }
          }
        case "tap":
          let element = target()
          if element.exists && element.isHittable { element.tap(); passed = true }
        case "choose":
          let label = action.label ?? ""
          let candidates = app.sheets.buttons.matching(identifier: label).allElementsBoundByIndex
            + app.alerts.buttons.matching(identifier: label).allElementsBoundByIndex
            + app.buttons.matching(identifier: label).allElementsBoundByIndex
          if let element = candidates.first(where: { $0.exists && $0.isHittable }) { element.tap(); passed = true }
        case "expectLabel":
          let element = target()
          if element.exists { readback = element.label; passed = readback.contains(action.contains ?? "") }
        case "expectScreen":
          let title = action.title ?? ""
          passed = app.navigationBars[title].exists || app.sheets[title].exists || app.alerts[title].exists
        case "relaunch":
          app.terminate(); app.launchArguments = []; app.launch()
          passed = app.navigationBars["Keyboard"].waitForExistence(timeout: 8)
        case "cancelClear":
          let region = app.otherElements["PopoverDismissRegion"]
          if app.sheets["Clear all learned words?"].exists && region.exists {
            region.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.5)).tap()
            passed = !app.sheets["Clear all learned words?"].exists
          }
        case "back":
          let button = app.navigationBars.buttons.element(boundBy: 0)
          if button.exists && button.isHittable { button.tap(); passed = app.navigationBars["Keyboard"].waitForExistence(timeout: 4) }
        default: break
        }
        commands.append(["index": index, "op": action.op, "target": action.target ?? "", "label": action.label ?? "", "passed": passed, "scrolls": scrolls, "readback": readback])
      }
      outcomes.append(["id": scenario.id, "commands": commands, "passed": commands.allSatisfy { $0["passed"] as? Bool == true }])
    }
    try JSONSerialization.data(withJSONObject: outcomes, options: [.prettyPrinted, .sortedKeys]).write(to: directory.appendingPathComponent("contract-outcomes.json"))
    XCTAssertTrue(outcomes.allSatisfy { $0["passed"] as? Bool == true }, "See retained command-level outcomes; unavailable/failed commands stay in denominator")
  }
}
