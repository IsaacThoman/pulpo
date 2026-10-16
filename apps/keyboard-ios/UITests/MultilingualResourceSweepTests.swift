import Darwin
import UIKit
import XCTest

@testable import KeyboardUI

/// Opt-in simulator workload. Run alone in a fresh runner for each mode/sample.
/// The independent protocol is frozen in audits/multilingual-resources-sweep.md.
@MainActor
final class MultilingualResourceSweepTests: XCTestCase {
  private var samples: [String: [Double]] = [:]
  private var observations: [String: String] = [:]
  private var traces: [String: [String]] = [:]
  private let environment = ProcessInfo.processInfo.environment

  private func timed<T>(_ name: String, _ operation: () throws -> T) rethrows -> T {
    let start = CACurrentMediaTime()
    let result = try operation()
    samples[name, default: []].append((CACurrentMediaTime() - start) * 1_000)
    return result
  }

  private func memory(_ name: String) {
    var info = mach_task_basic_info()
    var size = mach_msg_type_number_t(
      MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
    let status = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(size)) {
        task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &size)
      }
    }
    if status == KERN_SUCCESS {
      samples["rssMiB.\(name)", default: []].append(Double(info.resident_size) / 1_048_576)
    }
  }

  private func pump() { RunLoop.current.run(until: Date().addingTimeInterval(0.02)) }

  func testFrozenResourceWorkload() throws {
    guard let directory = environment["PK_RESOURCE_DATA"],
      let mode = environment["PK_RESOURCE_MODE"],
      let language = KeyboardLanguage(rawValue: mode)
    else {
      throw XCTSkip("Set TEST_RUNNER_PK_RESOURCE_DATA and TEST_RUNNER_PK_RESOURCE_MODE")
    }
    let heldOut = environment["PK_RESOURCE_HELDOUT"] == "1"
    let data = URL(fileURLWithPath: directory)
    let personalURL = FileManager.default.temporaryDirectory.appendingPathComponent(
      "resource-\(UUID().uuidString).json")
    defer { try? FileManager.default.removeItem(at: personalURL) }
    observations["process"] = "XCTest UI runner, pid \(getpid()); not extension or physical device"
    observations["mode"] = mode
    observations["partition"] = heldOut ? "held-out" : "development"
    observations["configuration"] =
      "Debug; repository default XCTest configuration; unchanged compiler/language settings"
    memory("start")
    var stack = try timed("cold.stack") {
      try LanguageStack(
        dictionaryURL: data.appendingPathComponent("\(mode).pkdict"), personalURL: personalURL)
    }
    let catalog = try timed("cold.emojiDecode") {
      try EmojiCatalog.load(url: data.appendingPathComponent("emoji.json"))
    }
    let index = timed("cold.emojiIndex") { EmojiSuggester(catalog: catalog) }
    memory("resources")

    let development: [KeyboardLanguage: String] = [
      .english: "Please bring the blue folder at nine. We can meet near the library.",
      .spanish: "Mañana podemos tomar café junto al río. Lleva también el cuaderno azul.",
      .bilingual: "Please trae el cuaderno azul. Tomorrow tomamos café near the library.",
    ]
    let held: [KeyboardLanguage: String] = [
      .english: "A quiet train leaves before sunset. Pack the green notebook.",
      .spanish: "El sábado llega mi prima. Buscamos una mesa cerca del jardín.",
      .bilingual: "My prima arrives el sábado. Bring una chaqueta for the train.",
    ]
    let prefixes: [KeyboardLanguage: [String]] =
      heldOut
      ? [.english: ["qui"], .spanish: ["jar"], .bilingual: ["cha"]]
      : [
        .english: ["ple", "brin", "lib"], .spanish: ["mañ", "caf", "cuad"],
        .bilingual: ["tom", "lib", "cua"],
      ]
    for pass in 0..<6 {
      let document = ResourceSweepDocument()
      var settings = KeyboardSettings()
      settings.language = language
      settings.learnWords = false  // Explicit, independent vocabulary phase below.
      let engine = KeyboardEngine(
        document: document, suggester: stack.suggester, glide: stack.glide, settings: settings)
      engine.emojiSuggester = index
      let phase = pass == 0 ? "cold" : "warm"
      // Attaches document state; suggestions are evaluated inside keyAndSuggestions.
      timed("\(phase).documentAttachment") { engine.documentDidChange() }
      for character in (heldOut ? held : development)[language]! {
        let suggestions = timed("\(phase).keyAndSuggestions") {
          if character == " " {
            engine.insertSpace()
          } else {
            engine.insertCharacter(String(character))
          }
          return engine.suggestions
        }
        traces["typed.\(pass)", default: []].append(String(describing: suggestions))
      }
      observations["typed.\(pass)"] = document.text
      for prefix in prefixes[language]! {
        timed("\(phase).prefixSuggestion") {
          _ = stack.suggester.suggestions(
            for: TypedWord(text: prefix), context: .unknown, autocorrect: true)
        }
      }
    }

    let vocabulary = (0..<128).map { String(format: heldOut ? "holdlex%03d" : "devlex%03d", $0) }
    timed("learn.seed128") { for word in vocabulary { stack.personal.pin(word) } }
    timed("learn.save") { stack.personal.save() }
    let reloaded = timed("learn.reload") { PersonalDictionary(url: personalURL) }
    for position in [0, 64, 127] { XCTAssertTrue(reloaded.isKnown(vocabulary[position])) }
    XCTAssertFalse(reloaded.isKnown(heldOut ? "devlex000" : "holdlex000"))
    observations["learnedWords"] = "128 independently seeded; first/middle/last survive disk reload"
    for word in [vocabulary[0], vocabulary[64], vocabulary[127]] {
      timed("learn.query") {
        let result = stack.suggester.suggestions(
          for: TypedWord(text: word), context: .unknown, autocorrect: true)
        XCTAssertTrue(result.slots.contains { $0.text.lowercased() == word })
      }
    }

    let sequence: [KeyboardLanguage] =
      heldOut
      ? [.bilingual, .spanish, .english, .bilingual] : [.english, .spanish, .bilingual, .english]
    let switchPrefixes = heldOut ? ["re", "pa", "co"] : ["ca", "th", "ma"]
    for cycle in 0..<21 {
      try autoreleasepool {
        for next in sequence {
          let previous = stack
          stack = try timed("switch.\(cycle == 0 ? "first" : "warm").\(next.rawValue)") {
            try LanguageStack(
              dictionaryURL: data.appendingPathComponent("\(next.rawValue).pkdict"),
              sharing: previous)
          }
          XCTAssertTrue(stack.personal === previous.personal)
          XCTAssertTrue(stack.touch === previous.touch)
          for prefix in switchPrefixes {
            timed("switch.suggestion") {
              _ = stack.suggester.suggestions(
                for: TypedWord(text: prefix), context: .unknown, autocorrect: true)
            }
          }
          XCTAssertTrue(stack.personal.isKnown(vocabulary[127]))
        }
      }
    }
    memory("afterSwitching")

    // Synchronous UIKit actions/layout: these are not compositor-visible times.
    // Real XCUI taps establish interaction cost in the separate test below.
    KeyboardResources.directory = data
    defer { KeyboardResources.directory = nil }
    let original = SettingsStore().load()
    var controllerSettings = original
    controllerSettings.language = language
    controllerSettings.learnWords = false
    controllerSettings.haptics = false
    SettingsStore().save(controllerSettings)
    defer { SettingsStore().save(original) }
    let host = ResourceSweepHost()
    let controller = timed("controller.init") {
      KeyboardController(host: host, dictationBridge: nil)
    }
    controller.emojiResourcesLoaded(catalog: catalog, suggester: index)
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
    let container = UIViewController()
    window.rootViewController = container
    controller.rootView.frame = CGRect(x: 0, y: 500, width: 402, height: 330)
    container.view.addSubview(controller.rootView)
    window.makeKeyAndVisible()
    defer { window.isHidden = true }
    controller.hostWillAppear()
    controller.rootView.layoutIfNeeded()
    let queries = heldOut ? ["train", "heart"] : ["coffee", "smile"]
    for cycle in 0..<21 {
      try autoreleasepool {
        for selected in sequence {
          timed("controller.modeSwitch") { choose(selected, in: controller) }
          XCTAssertEqual(host.language, selected.primaryLanguage)
        }
        timed("controller.returnToMeasuredMode") { choose(language, in: controller) }
        let before = host.text.text
        timed("controller.emojiOpenAndLayout") {
          controller.keysView(
            controller.rootView.keys, activate: Key(action: .emoji, label: "emoji"), at: .zero)
          controller.rootView.layoutIfNeeded()
        }
        let panel = try XCTUnwrap(controller.rootView.emoji)
        let categories = buttons(in: panel).filter {
          $0.tag > 0 && $0.accessibilityIdentifier == nil && $0.accessibilityLabel != nil
        }
        XCTAssertGreaterThanOrEqual(categories.count, 3)
        for button in (heldOut ? Array(categories.reversed()) : categories).prefix(3) {
          timed("controller.emojiCategory") {
            button.sendActions(for: .touchUpInside)
            controller.rootView.layoutIfNeeded()
          }
        }
        controller.emojiPanelSearch(panel)
        XCTAssertNil(controller.rootView.emoji, "Hidden picker must release its images/views")
        for query in queries {
          for letter in query {
            timed("controller.searchKeyAndLayout") {
              controller.keysView(
                controller.rootView.keys,
                activate: Key(action: .character(String(letter)), label: String(letter)), at: .zero)
              controller.rootView.layoutIfNeeded()
            }
          }
          XCTAssertEqual(controller.rootView.search.query, query)
          XCTAssertFalse(controller.rootView.search.results.isEmpty)
          XCTAssertEqual(host.text.text, before, "Search query leaked into host document")
          for _ in query {
            controller.keysView(
              controller.rootView.keys, touchDown: Key(action: .delete, label: "delete"))
          }
        }
        let result = try XCTUnwrap(controller.rootView.search.results.first)
        controller.rootView.search.onSelect?(result)
        XCTAssertEqual(host.text.text, before + result.value)
        timed("controller.dismiss") { controller.hostDidDisappear() }
        XCTAssertNil(controller.rootView.emoji)
        timed("controller.reappearAndLayout") {
          controller.hostWillAppear()
          controller.rootView.layoutIfNeeded()
        }
        XCTAssertEqual(controller.engine.settings.language, language)
        XCTAssertEqual(host.text.text, before + result.value)
        if heldOut {
          controller.hostDidDisappear()
          controller.hostWillAppear()
        }
        pump()
      }
      if cycle == 0 { memory("warmup") }
      memory("cycle\(cycle)")
    }
    controller.hostDidDisappear()
    memory("end")
    let summaries = samples.mapValues { values -> [String: Double] in
      let sorted = values.sorted()
      return [
        "n": Double(values.count), "median": sorted[sorted.count / 2],
        "p95": sorted[min(sorted.count - 1, Int(ceil(Double(sorted.count) * 0.95)) - 1)],
        "max": sorted.last!,
      ]
    }
    let report: [String: Any] = [
      "observations": observations, "samples": samples, "summary": summaries, "traces": traces,
    ]
    let json = try JSONSerialization.data(
      withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
    if let output = environment["PK_RESOURCE_REPORT"] {
      try json.write(to: URL(fileURLWithPath: output).appendingPathExtension("\(getpid()).json"))
    }
    print("RESOURCE_SWEEP " + String(decoding: json, as: UTF8.self))
  }

  private func buttons(in view: UIView) -> [UIButton] {
    (view as? UIButton).map { [$0] } ?? view.subviews.flatMap { buttons(in: $0) }
  }
}

/// Switches language the way the app does: through shared settings, picked up on appear.
@MainActor
private func choose(_ language: KeyboardLanguage, in controller: KeyboardController) {
  let store = SettingsStore()
  var settings = store.load()
  settings.language = language
  store.save(settings)
  controller.hostWillAppear()
}

@MainActor
private final class ResourceSweepHost: KeyboardHost {
  let text = ResourceSweepDocument()
  var document: TextDocument { text }
  var inputTraits = InputTraits()
  let needsInputModeSwitchKey = false
  let hasFullAccess = true
  let isInsideApp = true
  var language = ""
  func advanceToNextInputMode() {}
  func handleInputModeList(from view: UIView, with event: UIEvent) {}
  func adjustTextPosition(byCharacterOffset offset: Int) {}
  func openApp(_ url: URL) {}
  func setTypingLanguage(_ language: String) { self.language = language }
}

private final class ResourceSweepDocument: TextDocument {
  var text = ""
  var documentContextBeforeInput: String? { text }
  var documentContextAfterInput: String? { "" }
  var selectedText: String? { nil }
  var hasText: Bool { !text.isEmpty }
  func insertText(_ text: String) { self.text += text }
  func deleteBackward() { if !text.isEmpty { text.removeLast() } }
}

/// Real accessibility taps establish interaction cost, not precise UI latency.
@MainActor
final class MultilingualResourceInteractionTests: XCTestCase {
  func testModeEmojiSearchAndReappearance() throws {
    guard ProcessInfo.processInfo.environment["PK_RESOURCE_UI"] == "1" else {
      throw XCTSkip("Opt in with TEST_RUNNER_PK_RESOURCE_UI=1")
    }
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launchArguments = ["-PKPreview", "-PKResetSettings", "-PKResetLearning"]
    app.launch()
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 8))
    for title in ["English", "Español", "English + Español"] {
      app.chooseTypingLanguage(title)
      app.key("key-emoji").tap()
      XCTAssertTrue(app.key("emoji-panel").waitForExistence(timeout: 6))
      app.key("emoji-search-open").tap()
      for letter in "coffee" { app.key("key-\(letter)").tap() }
      let results = app.key("emoji-search-results").descendants(matching: .any).matching(
        NSPredicate(format: "identifier BEGINSWITH 'emoji-result-'"))
      XCTAssertGreaterThan(results.count, 0)
      results.firstMatch.tap()
      let inserted = app.previewText
      XCTAssertFalse(inserted.isEmpty)
      app.key("emoji-search-back").tap()
      app.buttons["emoji-abc"].tap()
      XCUIDevice.shared.press(.home)
      app.activate()
      XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 5))
      XCTAssertEqual(app.previewText, inserted)
    }
  }
}
