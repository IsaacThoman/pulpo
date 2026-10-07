#if os(iOS)
import UIKit

/// Colors and metrics measured from the system keyboard on iOS 18 and iOS 26+.
struct KeyboardStyle: Equatable {
  /// iOS 26 and later: rounder keys, no key shadows, every key the same color.
  let modern: Bool
  let dark: Bool
  let landscape: Bool
  /// Inside the system's iOS 26+ keyboard container, which already pads the top
  /// and bottom, so the keys land where the system keyboard's do.
  let inset: Bool

  init(modern: Bool, dark: Bool, landscape: Bool, inset: Bool = false) {
    self.modern = modern
    self.dark = dark
    self.landscape = landscape
    self.inset = inset && modern
  }

  static func current(dark: Bool, landscape: Bool, inset: Bool = false) -> KeyboardStyle {
    if #available(iOS 26, *) { return KeyboardStyle(modern: true, dark: dark, landscape: landscape, inset: inset) }
    return KeyboardStyle(modern: false, dark: dark, landscape: landscape)
  }

  // MARK: Metrics

  var barHeight: CGFloat { landscape ? (inset ? 32 : 38) : (inset ? 38 : 44) }
  var topPadding: CGFloat { landscape ? (inset ? 0 : 4) : (inset ? 1 : 8) }
  var keyHeight: CGFloat { landscape ? 32 : 43 }
  var rowGap: CGFloat { landscape ? 6 : 11 }
  var bottomPadding: CGFloat { inset ? 0 : (landscape ? 2 : 4) }
  var keyGap: CGFloat { landscape ? 6 : 6.5 }
  var cornerRadius: CGFloat { modern ? 8.5 : 5 }

  func sideMargin(width: CGFloat) -> CGFloat {
    if landscape { return max(modern ? 8 : 4, width * 0.012) }
    return modern ? 6.75 : 3
  }

  var keysHeight: CGFloat { topPadding + keyHeight * 4 + rowGap * 3 + bottomPadding }
  var totalHeight: CGFloat { barHeight + keysHeight }

  // MARK: Colors

  private static func rgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat) -> UIColor {
    UIColor(red: r / 255, green: g / 255, blue: b / 255, alpha: 1)
  }

  var background: UIColor {
    switch (modern, dark) {
    case (true, false): Self.rgb(224, 225, 232)
    case (true, true): Self.rgb(32, 32, 32)
    case (false, false): Self.rgb(208, 211, 218)
    case (false, true): Self.rgb(43, 43, 43)
    }
  }

  var inputKey: UIColor {
    switch (modern, dark) {
    case (_, false): .white
    case (true, true): Self.rgb(68, 68, 68)
    case (false, true): Self.rgb(107, 107, 107)
    }
  }

  var functionKey: UIColor {
    if modern { return inputKey }
    return dark ? Self.rgb(70, 70, 70) : Self.rgb(169, 175, 188)
  }

  var pressedInputKey: UIColor {
    if modern { return dark ? Self.rgb(110, 110, 110) : Self.rgb(186, 189, 198) }
    return functionKey
  }

  var pressedFunctionKey: UIColor {
    if modern { return pressedInputKey }
    return inputKey
  }

  var label: UIColor { dark ? .white : .black }
  var secondaryLabel: UIColor { dark ? UIColor(white: 1, alpha: 0.55) : UIColor(white: 0, alpha: 0.45) }
  var divider: UIColor { dark ? UIColor(white: 1, alpha: 0.16) : UIColor(white: 0, alpha: 0.12) }
  var keyShadow: UIColor { dark ? UIColor(white: 0, alpha: 0.6) : UIColor(red: 0.53, green: 0.54, blue: 0.56, alpha: 1) }
  var accent: UIColor { UIColor.systemBlue }
  var trail: UIColor { dark ? UIColor(red: 0.45, green: 0.66, blue: 1, alpha: 0.9) : UIColor(red: 0.16, green: 0.45, blue: 0.95, alpha: 0.85) }
  var popup: UIColor { modern && !dark ? .white : inputKey }

  // MARK: Type

  var lowercaseLetterFont: UIFont { .systemFont(ofSize: landscape ? 21 : 23, weight: .regular) }
  var uppercaseLetterFont: UIFont { .systemFont(ofSize: landscape ? 19.5 : 21.5, weight: .regular) }
  var symbolFont: UIFont { .systemFont(ofSize: landscape ? 20 : 22, weight: .regular) }
  var functionFont: UIFont { .systemFont(ofSize: modern ? 18 : 16, weight: .regular) }
  var popupFont: UIFont { .systemFont(ofSize: 34, weight: .regular) }
  var hintFont: UIFont { .systemFont(ofSize: 10, weight: .medium) }
  var suggestionFont: UIFont { .systemFont(ofSize: 17, weight: .regular) }
  var suggestionEmphasisFont: UIFont { .systemFont(ofSize: 17, weight: .semibold) }
  var symbolConfiguration: UIImage.SymbolConfiguration { UIImage.SymbolConfiguration(pointSize: modern ? 19 : 18, weight: .regular) }
}
#endif
