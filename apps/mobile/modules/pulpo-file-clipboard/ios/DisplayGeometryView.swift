import ExpoModulesCore
import UIKit

/// Reports the display geometry under the window it fills: the edge where the
/// system places its vertical bar, regions occluded by sensors and that bar,
/// and fold regions content should divide around.
///
/// The vertical bar and reserved regions arrived with iPhone Duo in iOS 27.1.
/// They are looked up at runtime so this module still builds with older SDKs;
/// earlier systems report no bar and no regions.
public final class DisplayGeometryView: ExpoView {
  let onGeometryChange = EventDispatcher()

  private var lastGeometry: NSDictionary?

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    isAccessibilityElement = false
    accessibilityElementsHidden = true
    registerForTraitChanges([UITraitHorizontalSizeClass.self, UITraitVerticalSizeClass.self, UITraitLayoutDirection.self]) {
      (view: DisplayGeometryView, _: UITraitCollection) in
      view.setNeedsLayout()
    }
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    setNeedsLayout()
  }

  public override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    setNeedsLayout()
  }

  // Reserved regions read during layout invalidate it when they change, so
  // folding or unfolding the device lands here again.
  public override func layoutSubviews() {
    super.layoutSubviews()
    guard window != nil else { return }
    let geometry: NSDictionary = [
      "verticalBarEdge": verticalBarEdge(),
      "occlusions": reservedRegions(kind: "occlusionRegionKind").map { rectPayload($0.frame) },
      "divisions": reservedRegions(kind: "divisionRegionKind").map { region in
        var payload = rectPayload(region.frame)
        payload["margins"] = [
          "top": region.margins.top,
          "left": region.margins.left,
          "bottom": region.margins.bottom,
          "right": region.margins.right
        ]
        return payload
      }
    ]
    guard geometry != lastGeometry else { return }
    lastGeometry = geometry
    onGeometryChange(geometry as? [String: Any] ?? [:])
  }

  private func verticalBarEdge() -> String {
    let selector = NSSelectorFromString("verticalBarEdge")
    guard traitCollection.responds(to: selector), let edge = traitCollection.value(forKey: "verticalBarEdge") as? Int else {
      return "none"
    }
    // UIVerticalBarEdge: 0 unspecified, 1 leading, 2 trailing.
    switch edge {
    case 1: return "leading"
    case 2: return "trailing"
    default: return "none"
    }
  }

  private func reservedRegions(kind kindName: String) -> [(frame: CGRect, margins: UIEdgeInsets)] {
    guard
      let kindClass = NSClassFromString("UIViewReservedRegionKind") as? NSObject.Type,
      kindClass.responds(to: NSSelectorFromString(kindName)),
      let kind = kindClass.perform(NSSelectorFromString(kindName))?.takeUnretainedValue()
    else { return [] }
    // The single-argument query returns active regions only.
    let query = NSSelectorFromString("reservedRegionsOfKind:")
    guard responds(to: query), let regions = perform(query, with: kind)?.takeUnretainedValue() as? [NSObject] else {
      return []
    }
    return regions.compactMap { region in
      guard let frame = (region.value(forKey: "frame") as? NSValue)?.cgRectValue else { return nil }
      let margins = (region.value(forKey: "margins") as? NSValue)?.uiEdgeInsetsValue ?? .zero
      return (frame, margins)
    }
  }

  private func rectPayload(_ rect: CGRect) -> [String: Any] {
    ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height]
  }
}
