import UIKit
import XCTest
@testable import KeyboardUI

@MainActor
final class EmojiPresentationResourceTests: XCTestCase {
  func testPickerReusesImagesWithoutRetainingDismissedViewsAndClearsOnWarning() throws {
    let suite = "EmojiPresentationResourceTests-\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let values = ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🙂", "🙃", "😉", "😊", "😇"]
    let data = try JSONSerialization.data(withJSONObject: [
      "version": "test", "categories": [["id": "smileys", "name": "Smileys",
        "emoji": values.map { ["e": $0, "n": $0, "v": 1] as [String: Any] }]],
    ])
    let catalog = try JSONDecoder().decode(EmojiCatalog.self, from: data)
    func presentation(width: CGFloat = 402) throws -> (EmojiPanelView, [String: UIImage]) {
      let style = KeyboardStyle(modern: true, dark: false, landscape: false)
      let panel = EmojiPanelView(style: style, catalog: catalog, history: EmojiHistory(defaults: defaults))
      panel.frame = CGRect(x: 0, y: 0, width: width, height: style.totalHeight)
      panel.layoutIfNeeded()
      let collection = try XCTUnwrap(panel.subviews.compactMap { $0 as? UICollectionView }.first)
      collection.layoutIfNeeded()
      var images: [String: UIImage] = [:]
      for cell in collection.visibleCells.compactMap({ $0 as? EmojiCell }) {
        if let value = cell.emoji, let image = cell.imageView.image { images[value] = image }
      }
      XCTAssertFalse(images.isEmpty)
      return (panel, images)
    }
    weak var dismissed: EmojiPanelView?
    let first = try autoreleasepool {
      let (panel, images) = try presentation()
      dismissed = panel
      return images
    }
    XCTAssertNil(dismissed, "The shared cache must not retain a picker or its collection view")
    let second = try presentation()
    for (value, image) in second.1 { XCTAssertTrue(image === first[value], "Redrew \(value) on reappearance") }
    // A warning must release cached resources even with no visible picker.
    NotificationCenter.default.post(name: UIApplication.didReceiveMemoryWarningNotification, object: nil)
    let third = try presentation()
    for (value, image) in third.1 {
      XCTAssertFalse(image === second.1[value], "Memory warning did not clear \(value)")
      XCTAssertEqual(image.pngData(), second.1[value]?.pngData(), "Cache reuse changed rendered pixels")
    }
  }

  func testImageCacheEvictsAndInvalidatesWhenDrawingGeometryChanges() throws {
    let images = EmojiImages(pointSize: 30, limit: 2)
    let size = CGSize(width: 44, height: 50)
    let traits = UITraitCollection(displayScale: 3)
    let first = images.image("😀", size: size, traits: traits)
    let second = images.image("😃", size: size, traits: traits)
    XCTAssertTrue(images.image("😀", size: size, traits: traits).image === first.image)
    _ = images.image("😄", size: size, traits: traits)
    let redrawn = images.image("😃", size: size, traits: traits)
    XCTAssertFalse(redrawn.image === second.image, "Least recently used image was not evicted")
    XCTAssertTrue(images.image("😃", size: size, traits: traits).image === redrawn.image)
    let resized = images.image("😃", size: CGSize(width: 50, height: 60), traits: traits)
    XCTAssertFalse(resized.image === redrawn.image)
    let rescaled = images.image("😃", size: CGSize(width: 50, height: 60), traits: UITraitCollection(displayScale: 2))
    XCTAssertFalse(rescaled.image === resized.image)
    images.removeAll()
    XCTAssertFalse(images.image("😃", size: size, traits: traits).image === rescaled.image)
  }
}
