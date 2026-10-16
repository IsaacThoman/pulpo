import XCTest
import UIKit
@testable import KeyboardUI

/// Frozen input cases exercise production views and touch routing in a UIKit
/// window. Widths are simulated: this is not a human reachability study.
@MainActor
final class CompactLayoutUXTests: XCTestCase {
  private struct Case: Decodable {
    let id: String
    let width: CGFloat
    let height: CGFloat
    let language: String
    let dock: String
    let contentSize: String
    let bold: Bool
    let scenario: String
  }

  private struct Report: Encodable {
    let id: String
    var checks = 0
    var failures: [String] = []
    var keyWidth: CGFloat = 0
    var keyboardHeight: CGFloat = 0
    var dockAvailable = false
    var hostEnvelope: [CGFloat] = []
    var rootFrame: [CGFloat] = []
    var safeAreaInsets: [CGFloat] = []
    var controls: [String] = []
    var limitations: [String] = []
    mutating func gate(_ passes: Bool, _ description: String) {
      checks += 1
      if !passes { failures.append(description) }
    }
  }

  func testDevelopmentMatrix() throws { try run("development") }
  func testFreshMatrix() throws { try run("fresh") }

  private func run(_ phase: String) throws {
    let directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .deletingLastPathComponent().appendingPathComponent("audits/compact-layout-ux")
    let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: directory.appendingPathComponent("\(phase)-cases.json")))
    let original = SettingsStore().load()
    defer { SettingsStore().save(original) }
    var reports: [Report] = []
    for input in cases {
      reports.append(try autoreleasepool { try exercise(input) })
    }
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    if let output = ProcessInfo.processInfo.environment["PK_COMPACT_REPORT"] {
      try encoder.encode(reports).write(to: URL(fileURLWithPath: output.replacingOccurrences(of: "{phase}", with: phase)))
    }
    let failures = reports.flatMap { report in report.failures.map { "\(report.id): \($0)" } }
    print("COMPACT_UX \(phase): cases=\(reports.count) checks=\(reports.reduce(0) { $0 + $1.checks }) failed=\(failures.count)")
    XCTAssertTrue(failures.isEmpty, failures.prefix(24).joined(separator: "\n"))
  }

  private func exercise(_ input: Case) throws -> Report {
    var report = Report(id: input.id)
    let language: KeyboardLanguage = input.language == "en" ? .english : input.language == "es" ? .spanish : .bilingual
    let h = ControllerHarness(text: "", optimistic: true, waitsForEmoji: false)
    let vc = h.viewController
    let root = h.controller.rootView
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: max(input.width, 402), height: 900))
    let container = UIViewController()
    window.rootViewController = container
    let envelope = UIView(frame: CGRect(x: 0, y: 250, width: input.width, height: input.height))
    envelope.clipsToBounds = true
    container.view.addSubview(envelope)
    container.addChild(vc)
    envelope.addSubview(vc.view)
    vc.didMove(toParent: container)
    vc.traitOverrides.preferredContentSizeCategory = input.contentSize == "normal" ? .large : .accessibilityExtraExtraExtraLarge
    vc.traitOverrides.legibilityWeight = input.bold ? .bold : .regular
    window.makeKeyAndVisible()
    defer {
      h.disappear()
      vc.willMove(toParent: nil)
      vc.view.removeFromSuperview()
      vc.removeFromParent()
      window.isHidden = true
    }
    vc.view.frame = CGRect(x: 0, y: 0, width: input.width, height: h.controller.preferredHeight)
    h.controller.layoutChanged(dark: false)
    vc.view.frame.size.height = h.controller.preferredHeight
    vc.view.layoutIfNeeded()
    // A real input host follows onHeightChange after width-driven layout.
    // This frame-based host must likewise apply the newly preferred height.
    h.controller.layoutChanged(dark: false)
    vc.view.frame.size.height = h.controller.preferredHeight
    vc.view.setNeedsLayout()
    vc.view.layoutIfNeeded()
    h.controller.rootView.bar.onLanguage?(language)
    h.controller.keysView(root.keys, chooseOneHanded: input.dock == "left" ? .left : input.dock == "right" ? .right : .off)
    h.pump()
    // Bold Text is read globally by production. Inject its production style
    // explicitly as well as the trait; do not claim a system-settings test.
    func layout() {
      let style = KeyboardStyle(modern: true, dark: false, landscape: input.width > 500, inset: true, bold: input.bold)
      root.apply(style)
      root.keys.setLayout(root.keys.layout, style: style)
      root.layoutIfNeeded()
      root.bar.layoutIfNeeded()
      root.keys.layoutIfNeeded()
      root.sidePanel.layoutIfNeeded()
    }
    layout()
    report.keyWidth = root.keys.bounds.width
    report.keyboardHeight = root.bounds.height
    report.dockAvailable = root.canDock
    report.hostEnvelope = [input.width, input.height]
    report.rootFrame = [root.frame.minX, root.frame.minY, root.frame.width, root.frame.height]
    report.safeAreaInsets = [root.safeAreaInsets.top, root.safeAreaInsets.left, root.safeAreaInsets.bottom, root.safeAreaInsets.right]
    report.limitations = ["Injected content-size/legibility traits and production bold style; not system Settings or VoiceOver speech", "UIKit action dispatch follows hit testing; only separate XCUI methods synthesize real events", "Language choices use the controller callback; separate XCUI method verifies actual menu presentation", "Spanish accents use the shared QWERTY layout; no dedicated visible ñ key", "Fixed native keyboard metrics do not scale with Dynamic Type"]
    if input.dock != "full" && !root.canDock {
      report.limitations.append("Requested docking unavailable at this width/orientation; verified full width and absence of side controls")
    }
    report.gate(root.bounds.width == input.width, "host width was not applied")
    report.gate(root.bounds.height <= input.height, "production keyboard exceeds host height envelope")
    report.gate(h.engine.settings.language == language, "language selection did not reach engine")
    report.gate(vc.traitCollection.preferredContentSizeCategory == (input.contentSize == "normal" ? .large : .accessibilityExtraExtraExtraLarge), "content size trait missing")

    func visible(_ view: UIView) -> Bool {
      var ancestor: UIView? = view
      while let current = ancestor {
        if current.isHidden || current.alpha < 0.01 { return false }
        if current === root { return true }
        ancestor = current.superview
      }
      return false
    }
    func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
    func checkButtons(_ stage: String) {
      for button in descendants(root).compactMap({ $0 as? UIControl }) where visible(button) && button.isEnabled {
        let name = button.accessibilityIdentifier ?? button.accessibilityLabel ?? (button as? UIButton)?.currentTitle ?? "button"
        let rect = button.convert(button.bounds, to: root)
        // Scrollable emoji results can intentionally extend outside their strip.
        var visibleRect = rect.intersection(root.bounds)
        var ancestor = button.superview
        while let view = ancestor, view !== root {
          if view.clipsToBounds { visibleRect = visibleRect.intersection(view.convert(view.bounds, to: root)) }
          ancestor = view.superview
        }
        if visibleRect.isNull || visibleRect.isEmpty {
          if !(button is EmojiResultControl) { report.gate(false, "\(stage)/\(name): fully clipped or empty control") }
          continue
        }
        if !report.controls.contains(name) { report.controls.append(name) }
        if !(button is EmojiResultControl) {
          report.gate(rect.width > 0 && rect.height > 0 && root.bounds.insetBy(dx: -0.5, dy: -0.5).contains(rect), "\(stage)/\(name): clipped or empty control \(rect)")
        }
        report.gate(!(button.accessibilityLabel ?? (button as? UIButton)?.currentTitle ?? "").isEmpty, "\(stage)/\(name): missing meaning")
        // Interior samples include the visible lower portion, not just centers.
        for x in [CGFloat(0.02), 0.15, 0.5, 0.85, 0.98] {
          for y in [CGFloat(0.02), 0.15, 0.5, 0.85, 0.98] {
            let point = CGPoint(x: visibleRect.minX + visibleRect.width * x, y: visibleRect.minY + visibleRect.height * y)
            let hit = root.hitTest(point, with: nil)
            report.gate(hit === button || hit?.isDescendant(of: button) == true, "\(stage)/\(name): interior \(x),\(y) routed to \(hit.map { String(describing: type(of: $0)) } ?? "nil")")
          }
        }
      }
    }
    func checkKeys(_ stage: String) {
      for cap in root.keys.keyViews where cap.isEnabled {
        report.gate(root.keys.bounds.insetBy(dx: -0.5, dy: -0.5).contains(cap.frame), "\(stage)/\(cap.key.identifier): clipped key")
        report.gate(!(cap.accessibilityLabel ?? "").isEmpty, "\(stage)/\(cap.key.identifier): missing label")
        for x in [CGFloat(0.02), 0.5, 0.98] {
          for y in [CGFloat(0.02), 0.5, 0.98] {
            let point = CGPoint(x: cap.frame.minX + cap.frame.width * x, y: cap.frame.minY + cap.frame.height * y)
            let hit = root.hitTest(root.keys.convert(point, to: root), with: nil)
            report.gate(hit === root.keys, "\(stage)/\(cap.key.identifier): interior missed grid")
            let index = root.keys.keyIndex(at: point)
            report.gate(index.map { root.keys.keyViews[$0] === cap } == true, "\(stage)/\(cap.key.identifier): wrong key selected")
          }
        }
      }
    }
    func tap(_ identifier: String) throws {
      let cap = try XCTUnwrap(root.keys.keyViews.first { $0.key.identifier == identifier })
      let touch = Contact(point: CGPoint(x: cap.frame.midX, y: cap.frame.midY))
      report.gate(root.hitTest(root.keys.convert(touch.point, to: root), with: nil) === root.keys, "\(identifier): touch dispatch did not reach grid")
      root.keys.touchesBegan([touch], with: nil)
      root.keys.touchesEnded([touch], with: nil)
      h.settle()
      h.pump()
      layout()
    }

    checkButtons("initial")
    let languageButton = try XCTUnwrap(root.bar.subviews.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "keyboard-language" })
    report.gate(languageButton.menu?.children.count == 4 && languageButton.showsMenuAsPrimaryAction, "language menu choices unavailable")
    report.gate(languageButton.accessibilityLabel?.contains(language.title) == true, "language label lost full language meaning")
    checkKeys("letters")
    if !root.sidePanel.isHidden {
      let originalSide = root.oneHanded
      let originalWidth = root.keys.bounds.width
      let move = root.sidePanel.subviews.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "one-handed-move" }
      move?.sendActions(for: .touchUpInside)
      layout()
      report.gate(root.oneHanded == originalSide.flipped && root.keys.bounds.width == originalWidth, "move side failed or drifted width")
      let expand = root.sidePanel.subviews.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "one-handed-expand" }
      expand?.sendActions(for: .touchUpInside)
      layout()
      report.gate(root.sidePanel.isHidden && root.keys.bounds.width == input.width, "expand failed to restore full width")
      h.controller.keysView(root.keys, chooseOneHanded: originalSide)
      layout()
      report.gate(root.keys.bounds.width == originalWidth, "redocking drifted key width")
    }
    let suggestions = root.bar.suggestions
    root.bar.setSuggestions([])
    layout()
    checkButtons("empty-bar")
    report.gate(root.hitTest(CGPoint(x: root.bar.frame.midX, y: root.bar.frame.midY), with: nil) === root.keys, "unused bar background stopped forwarding")
    root.bar.setSuggestions([Suggestion(text: "test", kind: .literal)])
    layout()
    if let disabled = root.bar.subviews.compactMap({ $0 as? SlotControl }).first(where: { !$0.isEnabled }) {
      let center = disabled.convert(CGPoint(x: disabled.bounds.midX, y: disabled.bounds.midY), to: root)
      report.gate(root.hitTest(center, with: nil) === root.keys, "disabled suggestion stopped forwarding")
    } else { report.gate(false, "disabled-slot fixture missing") }
    root.bar.setSuggestions(suggestions)
    layout()
    root.bar.microphoneVisible = false
    layout()
    checkButtons("mic-hidden")
    report.gate(root.bar.subviews.first { $0.accessibilityIdentifier == "dictate" }?.isHidden == true, "hidden microphone retained visible geometry")
    root.bar.microphoneVisible = true
    layout()
    for id in ["key-q", "key-w", "key-e"] { try tap(id) }
    report.gate(h.proxy.host.string.lowercased() == "qwe", "center taps did not type qwe")
    try tap("key-delete")
    report.gate(h.proxy.host.string.lowercased() == "qw", "delete did not remove one character")
    try tap("key-space")
    let afterSpace = h.proxy.host.string
    report.gate(afterSpace.hasSuffix(" "), "space did not insert")
    try tap("key-return")
    report.gate(h.proxy.host.string.hasSuffix("\n"), "return did not insert newline")
    try tap("key-numbers")
    checkKeys("numbers")
    try tap("key-symbols")
    checkKeys("symbols")
    try tap("key-letters")
    checkKeys("restored-letters")
    let beforeEmoji = h.proxy.host.string
    report.gate(h.pump(until: { h.engine.emojiSuggester != nil }, timeout: 120), "emoji resources unavailable")
    try tap("key-emoji")
    layout()
    root.emoji?.layoutIfNeeded()
    checkButtons("emoji")
    if let panel = root.emoji {
      let search = descendants(panel).compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "emoji-search-open" }
      report.gate(search != nil, "emoji search affordance missing")
      search?.sendActions(for: .touchUpInside)
      layout()
      root.search.layoutIfNeeded()
      checkButtons("emoji-search")
      checkKeys("emoji-search")
      for id in ["key-r", "key-e", "key-d"] { try tap(id) }
      report.gate(root.search.query == "red", "search keys did not enter query")
      report.gate(h.proxy.host.string == beforeEmoji, "search query leaked into host")
      let back = root.search.subviews.compactMap { $0 as? UIControl }.first { $0.accessibilityIdentifier == "emoji-search-back" }
      back?.sendActions(for: .touchUpInside)
      layout()
      if let restored = root.emoji { h.controller.emojiPanelClose(restored) }
      else { report.gate(false, "search back failed to restore picker") }
    } else { report.gate(false, "emoji picker did not present") }
    layout()
    report.gate(root.showsKeys && h.proxy.host.string == beforeEmoji, "emoji close failed to restore typing")
    checkKeys("after-emoji")

    // Visible Undo is generated by the real controller/engine deletion path.
    h.type("one two ")
    let beforeDeletion = h.proxy.host.string
    h.controller.keysView(root.keys, touchDown: try XCTUnwrap(h.key(.delete)))
    h.settle()
    h.controller.keysView(root.keys, previewWordDeletion: 1)
    h.controller.keysView(root.keys, commitWordDeletion: 1)
    h.settle()
    h.pump()
    layout()
    report.gate(h.proxy.host.string != beforeDeletion, "word deletion did not change text before Undo")
    checkButtons("undo")
    let undo = root.bar.subviews.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "undo-delete" && !$0.isHidden }
    report.gate(undo != nil, "Undo did not appear after word deletion")
    undo?.sendActions(for: .touchUpInside)
    h.settle()
    report.gate(h.proxy.host.string == beforeDeletion, "Undo action did not restore exact original text")

    // No microphone permission/server is needed to validate the real affordance
    // and message/close transition. Avoid recording or app navigation.
    root.mode = .dictation
    root.dictation.set(.message(title: "Full Access required", detail: "Enable Full Access to dictate.", action: "Open Settings"))
    root.layoutIfNeeded()
    root.dictation.layoutIfNeeded()
    checkButtons("dictation-message")
    if input.id.contains("rotation") {
      envelope.frame.size = CGSize(width: 812, height: 224)
      vc.view.frame.size.width = 812
      h.controller.layoutChanged(dark: false)
      vc.view.frame.size.height = h.controller.preferredHeight
      vc.view.setNeedsLayout()
      vc.view.layoutIfNeeded()
      h.controller.layoutChanged(dark: false)
      vc.view.frame.size.height = h.controller.preferredHeight
      vc.view.setNeedsLayout()
      vc.view.layoutIfNeeded()
      root.dictation.layoutIfNeeded()
      report.gate(root.bounds.height <= envelope.bounds.height, "rotated production keyboard exceeds host height envelope")
      report.gate(root.bounds.width == 812 && root.style.landscape, "portrait-to-landscape did not reflow production controller")
      report.gate(root.dictation.frame == root.bounds, "presentation did not follow rotation bounds")
      checkButtons("rotated-presentation")
      root.mode = .keys
      root.layoutIfNeeded()
      root.keys.layoutIfNeeded()
      checkKeys("rotated-letters")
      vc.view.frame.size.width = input.width
      envelope.frame.size = CGSize(width: input.width, height: input.height)
      h.controller.layoutChanged(dark: false)
      vc.view.frame.size.height = h.controller.preferredHeight
      vc.view.setNeedsLayout()
      vc.view.layoutIfNeeded()
      h.controller.layoutChanged(dark: false)
      vc.view.frame.size.height = h.controller.preferredHeight
      vc.view.setNeedsLayout()
      vc.view.layoutIfNeeded()
      report.gate(root.bounds.width == input.width && !root.style.landscape, "landscape-to-portrait did not restore root")
    }
    if input.id.contains("live-ax") {
      root.mode = .keys
      layout()
      vc.traitOverrides.preferredContentSizeCategory = .large
      vc.view.setNeedsLayout()
      vc.view.layoutIfNeeded()
      report.gate(vc.traitCollection.preferredContentSizeCategory == .large, "live content-size change missing")
      checkButtons("live-normal-text")
      vc.traitOverrides.preferredContentSizeCategory = .accessibilityExtraExtraExtraLarge
      vc.view.setNeedsLayout()
      vc.view.layoutIfNeeded()
      report.gate(vc.traitCollection.preferredContentSizeCategory == .accessibilityExtraExtraExtraLarge, "live accessibility category restore missing")
      checkButtons("live-accessibility-text")
    }
    root.mode = .keys
    layout()
    checkButtons("restored")
    checkKeys("final")
    report.gate(h.engine.settings.language == language, "mode transitions lost language")
    return report
  }

  private final class Contact: UITouch {
    let point: CGPoint
    init(point: CGPoint) { self.point = point; super.init() }
    override func location(in view: UIView?) -> CGPoint { point }
    override var timestamp: TimeInterval { ProcessInfo.processInfo.systemUptime }
  }
}

/// Real XCTest event synthesis supplements in-process hit testing.
@MainActor
final class CompactLayoutInteractionTests: PreviewTypingTestCase {
  func testLowerLanguageControlOpensMenuWithoutTyping() {
    let language = app.key("keyboard-language")
    language.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.94)).tap()
    XCTAssertTrue(app.buttons["Español"].waitForExistence(timeout: 3), "A lower language tap should open the language menu")
    XCTAssertEqual(app.previewText, "", "A language tap must not type a letter")
    app.buttons["Español"].tap()
    XCTAssertTrue(language.label.contains("Español"))
  }

  func testLowerMicrophoneControlPresentsDictationWithoutTyping() {
    let mic = app.key("dictate")
    mic.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.94)).tap()
    XCTAssertTrue(app.key("dictation-panel").waitForExistence(timeout: 3))
    XCTAssertEqual(app.previewText, "", "A microphone tap must not type a letter")
    app.key("dictation-cancel").tap()
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 3))
  }
}
