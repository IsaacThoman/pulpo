import UIKit
import XCTest
@testable import KeyboardUI
@testable import PulpoKeyboard

/// Exposed native UI evidence. Uses mounted production cells, public custom-action
/// dispatch, and the production controller delegate into a real UITextView.
@MainActor
final class EmojiToneAccessibilityR50Tests: XCTestCase {
  private func descendants<T: UIView>(_ view: UIView, _: T.Type) -> [T] {
    (view as? T).map { [$0] } ?? view.subviews.flatMap { descendants($0, T.self) }
  }
  private func settle() { RunLoop.main.run(until: Date().addingTimeInterval(0.15)) }
  private func witness(_ name: String, _ cells: [EmojiCell]) {
    let text = cells.map { "\($0.accessibilityIdentifier ?? "nil") | \($0.accessibilityLabel ?? "nil") | \($0.accessibilityValue ?? "nil") | \(($0.accessibilityCustomActions ?? []).map(\.name))" }.joined(separator: "\n")
    let a = XCTAttachment(string: text); a.name = name; a.lifetime = .keepAlways; add(a)
    if let window = cells.first?.window {
      let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
      let a = XCTAttachment(image: image); a.name = name + "-mounted"; a.lifetime = .keepAlways; add(a)
    }
  }

  func testMountedToneActionsInsertionReopenRecentsAndReuse() throws {
    let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
    let window = UIWindow(windowScene: scene)
    let vc = UIViewController(); window.rootViewController = vc; window.makeKeyAndVisible()
    defer { window.isHidden = true; window.rootViewController = nil }
    let editor = UITextView(frame: CGRect(x: 12, y: 70, width: 360, height: 150))
    editor.text = "Hola hello "; editor.selectedRange = NSRange(location: editor.text.utf16.count, length: 0)
    vc.view.addSubview(editor)
    let host = PreviewHost(textView: editor) { _ in XCTFail("Unexpected navigation") }
    let controller = KeyboardController(host: host, dictationBridge: nil)
    let suite = "r50-emoji-" + UUID().uuidString
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite); controller.hostDidDisappear() }
    let history = EmojiHistory(defaults: defaults)
    let catalog = try EmojiCatalog.load(url: XCTUnwrap(KeyboardResources.url("emoji", "json")))
    let thumb = try XCTUnwrap(catalog.categories.flatMap(\.emoji).first { $0.value == "👍" })
    history.setPreferred("👍🏽", for: thumb)
    history.use("👍🏻"); history.use("👍🏿")
    let style = KeyboardStyle(modern: true, dark: false, landscape: false)
    func mount() -> EmojiPanelView {
      let panel = EmojiPanelView(style: style, catalog: catalog, history: history)
      panel.delegate = controller
      panel.frame = CGRect(x: 0, y: 250, width: window.bounds.width, height: 300)
      vc.view.addSubview(panel); panel.layoutIfNeeded(); settle()
      return panel
    }
    func cell(_ panel: EmojiPanelView, section: Int, item: Int) throws -> EmojiCell {
      let grid = try XCTUnwrap(descendants(panel, UICollectionView.self).first)
      let path = IndexPath(item: item, section: section)
      grid.scrollToItem(at: path, at: .left, animated: false); grid.layoutIfNeeded(); settle()
      return try XCTUnwrap(grid.cellForItem(at: path) as? EmojiCell)
    }
    let section = try XCTUnwrap(catalog.categories.firstIndex { $0.emoji.contains(thumb) }) + 1
    let item = try XCTUnwrap(catalog.categories[section - 1].emoji.firstIndex(of: thumb))
    var panel = mount()
    let recentDark = try cell(panel, section: 0, item: 0)
    let recentLight = try cell(panel, section: 0, item: 1)
    witness("recents-stored-tones", [recentDark, recentLight])
    XCTAssertEqual(recentDark.accessibilityValue, "Dark skin tone")
    XCTAssertEqual(recentLight.accessibilityValue, "Light skin tone")
    XCTAssertTrue((recentDark.accessibilityCustomActions ?? []).isEmpty)
    // Real collection selection binding inserts the stored recent, not preference.
    let grid = try XCTUnwrap(descendants(panel, UICollectionView.self).first)
    panel.collectionView(grid, didSelectItemAt: IndexPath(item: 0, section: 0))
    XCTAssertEqual(editor.text, "Hola hello 👍🏿")
    let category = try cell(panel, section: section, item: item)
    witness("category-preferred-tone", [category])
    XCTAssertEqual(category.accessibilityValue, "Medium skin tone")
    let expected = ["Default skin tone", "Light skin tone", "Medium-light skin tone", "Medium skin tone", "Medium-dark skin tone", "Dark skin tone"]
    let actions = category.accessibilityCustomActions ?? []
    XCTAssertEqual(actions.map(\.name), expected.map { "Insert thumbs up, " + $0 })
    let action = try XCTUnwrap(actions.first { $0.name == "Insert thumbs up, Light skin tone" })
    XCTAssertTrue(try XCTUnwrap(action.actionHandler)(action))
    XCTAssertEqual(editor.text, "Hola hello 👍🏿👍🏻")
    XCTAssertEqual(history.preferred(for: thumb), "👍🏻")
    let removedAction = try XCTUnwrap(category.accessibilityCustomActions?.first)
    panel.removeFromSuperview()
    let removedText = editor.text
    XCTAssertFalse(try XCTUnwrap(removedAction.actionHandler)(removedAction))
    XCTAssertEqual(editor.text, removedText)
    XCTAssertEqual(history.preferred(for: thumb), "👍🏻")
    panel = mount()
    let reopened = try cell(panel, section: section, item: item)
    witness("reopened-preference", [reopened])
    XCTAssertEqual(reopened.accessibilityValue, "Light skin tone")
    // Exercise every actual named choice, including resetting to the default.
    for (name, value) in zip(expected.reversed(), ([thumb.value] + (thumb.tones ?? [])).reversed()) {
      let current = try cell(panel, section: section, item: item)
      let action = try XCTUnwrap(current.accessibilityCustomActions?.first { $0.name == "Insert thumbs up, " + name })
      XCTAssertTrue(try XCTUnwrap(action.actionHandler)(action))
      XCTAssertTrue(editor.text.hasSuffix(value)); XCTAssertEqual(history.preferred(for: thumb), value)
      settle()
    }
    let retained = try cell(panel, section: section, item: item)
    let stale = try XCTUnwrap(retained.accessibilityCustomActions?.first)
    // Actual UIKit reuse lifecycle: keep the old public action and prove it inert.
    retained.prepareForReuse()
    XCTAssertNil(retained.accessibilityValue); XCTAssertNil(retained.accessibilityCustomActions)
    let before = editor.text
    let beforePreference = history.preferred(for: thumb)
    XCTAssertFalse(try XCTUnwrap(stale.actionHandler)(stale))
    XCTAssertEqual(editor.text, before)
    XCTAssertEqual(history.preferred(for: thumb), beforePreference)
    // Scroll through enough production content to enumerate reused non-tone cells.
    var seen: Set<ObjectIdentifier> = [ObjectIdentifier(retained)]; var reusedNonTone = 0; var retainedReconfigured = 0
    for s in 1...catalog.categories.count {
      let activeGrid = try XCTUnwrap(descendants(panel, UICollectionView.self).first)
      let count = panel.collectionView(activeGrid, numberOfItemsInSection: s)
      guard count > 0 else { continue }
      _ = try cell(panel, section: s, item: 0)
      for c in activeGrid.visibleCells.compactMap({ $0 as? EmojiCell }) {
        let id = ObjectIdentifier(c)
        if seen.contains(id), let value = c.emoji,
           let base = catalog.categories.flatMap(\.emoji).first(where: { $0.value == value }), base.tones == nil {
          reusedNonTone += 1
          XCTAssertNil(c.accessibilityValue); XCTAssertTrue((c.accessibilityCustomActions ?? []).isEmpty)
          if id == ObjectIdentifier(retained) {
            retainedReconfigured += 1
            let before = editor.text
            let preference = history.preferred(for: thumb)
            XCTAssertFalse(try XCTUnwrap(stale.actionHandler)(stale))
            XCTAssertEqual(editor.text, before)
            XCTAssertEqual(history.preferred(for: thumb), preference)
          }
          if reusedNonTone == 1 { witness("recycled-nontone", [c]) }
        }
        seen.insert(id)
      }
    }
    let current = try cell(panel, section: section, item: item)
    let cancelled = try XCTUnwrap(current.accessibilityCustomActions?.first)
    let cancelText = editor.text
    let cancelPreference = history.preferred(for: thumb)
    panel.cancelInteractions()
    XCTAssertFalse(try XCTUnwrap(cancelled.actionHandler)(cancelled))
    XCTAssertEqual(editor.text, cancelText)
    XCTAssertEqual(history.preferred(for: thumb), cancelPreference)
    XCTAssertGreaterThan(reusedNonTone, 0)
    XCTAssertGreaterThan(retainedReconfigured, 0, "Retained tone cell must actually be reconfigured as non-tone content")
    let reuseEvidence = XCTAttachment(string: "reused non-tone cells inspected: \(reusedNonTone); retained tone cell reconfigured: \(retainedReconfigured); distinct cell objects: \(seen.count)")
    reuseEvidence.name = "reuse-denominators"; reuseEvidence.lifetime = .keepAlways; add(reuseEvidence)
  }
}
