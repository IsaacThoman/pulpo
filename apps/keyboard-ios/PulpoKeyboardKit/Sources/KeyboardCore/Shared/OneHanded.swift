import Foundation

/// Which edge a narrowed keyboard sits against, like the system keyboard's
/// one-handed layouts. `off` is the full-width keyboard.
public enum OneHandedMode: String, Codable, CaseIterable, Sendable {
  case off, left, right

  /// Only portrait phone keyboards dock; landscape stays full width, as on iOS.
  public static let maximumWidth = 500.0
  /// Keeps letter caps about 26 pt wide with the standard margins and gaps.
  public static let minimumKeysWidth = 332.0
  /// About the share of the width Apple's and Gboard's one-handed layouts keep.
  public static let keysFraction = 0.82
  /// Room the side controls need; narrower screens stay full width.
  public static let minimumPanelWidth = 40.0

  /// The key area's width on a keyboard `width` points wide. Full width when
  /// off, in landscape, or when the screen is too narrow to leave side controls.
  public func keysWidth(in width: Double) -> Double {
    guard self != .off, width > 0, width < Self.maximumWidth else { return width }
    let docked = max(Self.minimumKeysWidth, (width * Self.keysFraction).rounded())
    return width - docked >= Self.minimumPanelWidth ? docked : width
  }

  /// The mode on the other edge; `off` stays off.
  public var flipped: OneHandedMode {
    switch self {
    case .off: .off
    case .left: .right
    case .right: .left
    }
  }
}

/// The one-handed choice, kept apart from the app-owned settings because the
/// keyboard changes it from its own menu. Without Full Access the keyboard
/// cannot write the App Group, so it passes its own defaults instead.
public struct OneHandedStore {
  public static let key = "oneHandedMode"
  private let defaults: UserDefaults?

  public init(defaults: UserDefaults?) {
    self.defaults = defaults
  }

  public func load() -> OneHandedMode {
    defaults?.string(forKey: Self.key).flatMap(OneHandedMode.init(rawValue:)) ?? .off
  }

  public func save(_ mode: OneHandedMode) {
    defaults?.set(mode.rawValue, forKey: Self.key)
  }
}
