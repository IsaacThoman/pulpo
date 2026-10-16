import UIKit
import XCTest
@testable import KeyboardUI

/// Counts actual UICollectionView data-source requests during saved-position
/// restoration, rather than inferring redundant rendering from wall clock.
@MainActor
final class EmojiPresentationResourceTests: XCTestCase {
  func testRestoringScrollPositionBuildsOnlyTheSavedViewport() throws {
    let suite = "EmojiPresentationResourceTests-\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let supportKey = "emojiUnsupported2-\(UIDevice.current.systemVersion)"
    let previousSupport = UserDefaults.standard.object(forKey: supportKey)
    UserDefaults.standard.set([String](), forKey: supportKey)
    defer {
      if let previousSupport { UserDefaults.standard.set(previousSupport, forKey: supportKey) }
      else { UserDefaults.standard.removeObject(forKey: supportKey) }
    }
    let categories: [[String: Any]] = [("smileys", 0x1F600), ("travel", 0x1F680)].map { name, start in
      ["id": name, "name": name, "emoji": (0..<64).map { index in
        ["e": String(UnicodeScalar(start + index)!), "n": "\(name) \(index)", "v": 1] as [String: Any]
      }]
    }
    let data = try JSONSerialization.data(withJSONObject: ["version": "test", "categories": categories])
    let catalog = try JSONDecoder().decode(EmojiCatalog.self, from: data)
    var report: [[String: Any]] = []
    for landscape in [false, true] {
      for scale in [2.0, 3.0] {
        let style = KeyboardStyle(modern: true, dark: false, landscape: landscape)
        let frame = CGRect(x: 0, y: 0, width: landscape ? 852 : 402, height: style.totalHeight)
        let reference = EmojiPanelView(style: style, catalog: catalog, history: EmojiHistory(defaults: defaults))
        reference.frame = frame
        reference.layoutIfNeeded()
        let referenceGrid = try XCTUnwrap(reference.subviews.compactMap { $0 as? UICollectionView }.first)
        referenceGrid.layoutIfNeeded()
        let target = try XCTUnwrap(referenceGrid.layoutAttributesForItem(at: IndexPath(item: 0, section: 2)))
        let offset = min(target.frame.minX - 6, max(0, referenceGrid.contentSize.width - referenceGrid.bounds.width))
        referenceGrid.contentOffset.x = offset
        referenceGrid.layoutIfNeeded()
        let expected = Set(referenceGrid.indexPathsForVisibleItems)
        XCTAssertFalse(expected.isEmpty)
        XCTAssertTrue(expected.allSatisfy { $0.section == 2 })
        for _ in 0..<3 {
          try autoreleasepool {
            let panel = EmojiPanelView(style: style, catalog: catalog, history: EmojiHistory(defaults: defaults))
            let grid = try XCTUnwrap(panel.subviews.compactMap { $0 as? UICollectionView }.first)
            let recorder = ViewportRequests(panel: panel)
            grid.dataSource = recorder
            panel.traitOverrides.displayScale = CGFloat(scale)
            panel.scrollOffset = offset
            panel.frame = frame
            let start = CACurrentMediaTime()
            panel.layoutIfNeeded()
            grid.layoutIfNeeded()
            let elapsed = (CACurrentMediaTime() - start) * 1_000
            let starting = recorder.requests.filter { $0.section == 1 }.count
            let saved = recorder.requests.filter { $0.section == 2 }.count
            report.append(["landscape": landscape, "scale": scale, "startingViewportCells": starting,
                           "savedViewportCells": saved, "milliseconds": elapsed])
            print("PICKER_VIEWPORT landscape=\(landscape) scale=\(scale) starting=\(starting) saved=\(saved) ms=\(elapsed)")
            XCTAssertEqual(grid.contentOffset.x, offset, accuracy: 1)
            XCTAssertEqual(Set(grid.indexPathsForVisibleItems), expected)
            XCTAssertGreaterThan(saved, 0)
            if ProcessInfo.processInfo.environment["PK_RESOURCE_BASELINE_VIEWPORT"] == "1" {
              XCTAssertGreaterThan(starting, 0, "Baseline diagnostic must reproduce wasted initial viewport work")
            } else {
              XCTAssertEqual(starting, 0, "Restoration unnecessarily built the starting viewport")
            }
            // The picker must still handle an out-of-range saved offset safely.
            panel.scrollOffset = .greatestFiniteMagnitude
            panel.layoutIfNeeded()
            XCTAssertLessThanOrEqual(grid.contentOffset.x, max(0, grid.contentSize.width - grid.bounds.width))
            withExtendedLifetime(recorder) {}
          }
        }
      }
    }
    if let path = ProcessInfo.processInfo.environment["PK_VIEWPORT_REPORT"] {
      try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        .write(to: URL(fileURLWithPath: path))
    }
  }
}

@MainActor
private final class ViewportRequests: NSObject, UICollectionViewDataSource {
  let panel: EmojiPanelView
  var requests: [IndexPath] = []
  init(panel: EmojiPanelView) { self.panel = panel }
  func numberOfSections(in collectionView: UICollectionView) -> Int { panel.numberOfSections(in: collectionView) }
  func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
    panel.collectionView(collectionView, numberOfItemsInSection: section)
  }
  func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
    requests.append(indexPath)
    return panel.collectionView(collectionView, cellForItemAt: indexPath)
  }
}
