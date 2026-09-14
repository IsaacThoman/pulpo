import ExpoModulesCore
import UIKit

public final class StatusBarGradientView: ExpoView {
  private let gradient = CAGradientLayer()

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    isAccessibilityElement = false
    accessibilityElementsHidden = true
    gradient.startPoint = CGPoint(x: 0.5, y: 0)
    gradient.endPoint = CGPoint(x: 0.5, y: 1)
    gradient.locations = [0, 1]
    layer.addSublayer(gradient)
    registerForTraitChanges([UITraitUserInterfaceStyle.self, UITraitAccessibilityContrast.self, UITraitUserInterfaceLevel.self]) {
      (view: StatusBarGradientView, _: UITraitCollection) in
      view.updateColors()
    }
    updateColors()
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    updateColors()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    gradient.frame = bounds
    CATransaction.commit()
  }

  private func updateColors() {
    let background = UIColor.systemBackground.resolvedColor(with: traitCollection)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    gradient.colors = [background.cgColor, background.withAlphaComponent(0).cgColor]
    CATransaction.commit()
  }
}
