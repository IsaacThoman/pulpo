import XCTest

@MainActor
final class SettingsOuterSwitchProbeTests: XCTestCase {
  func testOuterContainerAndActualSwitch() throws {
    continueAfterFailure = true
    let app = XCUIApplication()
    app.launchArguments = ["-PKResetSettings"]
    app.launch()
    let learning = app.switches.matching(NSPredicate(format: "label BEGINSWITH %@", "Learn New Words,")).firstMatch
    for _ in 0..<12 where !(learning.exists && learning.isHittable) { app.swipeUp() }
    XCTAssertTrue(learning.exists && learning.isHittable)
    var result: [String: Any] = ["before": learning.value as? String ?? "", "outerFrame": String(describing: learning.frame)]
    learning.tap()
    result["afterOuterTap"] = learning.value as? String ?? ""
    XCTAssertEqual(learning.value as? String, "0", "Same exposed outer-container action that failed on candidate; preserve this raw failure")
    let actualSwitch = learning.switches.firstMatch
    XCTAssertTrue(actualSwitch.exists && actualSwitch.isHittable)
    result["actualSwitchFrame"] = String(describing: actualSwitch.frame)
    let expectedAfterActualTap = (learning.value as? String) == "1" ? "0" : "1"
    actualSwitch.tap()
    result["afterActualSwitchTap"] = learning.value as? String ?? ""
    XCTAssertEqual(learning.value as? String, expectedAfterActualTap)
    try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: "/tmp/pulpo-settings-usability-sweep/baseline-outer-switch-probe.json"))
  }
}
