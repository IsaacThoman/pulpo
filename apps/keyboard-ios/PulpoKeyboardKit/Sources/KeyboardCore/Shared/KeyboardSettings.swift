import Foundation

public struct KeyboardSettings: Codable, Equatable, Sendable {
  public var autocorrect = true
  public var autoCapitalization = true
  public var doubleSpacePeriod = true
  /// Curly quotes and moving an automatic space after punctuation.
  public var smartPunctuation = true
  public var predictions = true
  public var learnWords = true
  public var swipeTyping = true
  public var swipeTrail = true
  public var keyPopups = true
  public var haptics = true
  public var sounds = true
  public var digitHints = false
  /// How long the app keeps the microphone ready after a dictation.
  public var dictationStandbyMinutes = 5

  public init() {}

  public init(from decoder: any Decoder) throws {
    // Missing keys keep their defaults so older stored settings still decode.
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let defaults = KeyboardSettings()
    autocorrect = try container.decodeIfPresent(Bool.self, forKey: .autocorrect) ?? defaults.autocorrect
    autoCapitalization = try container.decodeIfPresent(Bool.self, forKey: .autoCapitalization) ?? defaults.autoCapitalization
    doubleSpacePeriod = try container.decodeIfPresent(Bool.self, forKey: .doubleSpacePeriod) ?? defaults.doubleSpacePeriod
    smartPunctuation = try container.decodeIfPresent(Bool.self, forKey: .smartPunctuation) ?? defaults.smartPunctuation
    predictions = try container.decodeIfPresent(Bool.self, forKey: .predictions) ?? defaults.predictions
    learnWords = try container.decodeIfPresent(Bool.self, forKey: .learnWords) ?? defaults.learnWords
    swipeTyping = try container.decodeIfPresent(Bool.self, forKey: .swipeTyping) ?? defaults.swipeTyping
    swipeTrail = try container.decodeIfPresent(Bool.self, forKey: .swipeTrail) ?? defaults.swipeTrail
    keyPopups = try container.decodeIfPresent(Bool.self, forKey: .keyPopups) ?? defaults.keyPopups
    haptics = try container.decodeIfPresent(Bool.self, forKey: .haptics) ?? defaults.haptics
    sounds = try container.decodeIfPresent(Bool.self, forKey: .sounds) ?? defaults.sounds
    digitHints = try container.decodeIfPresent(Bool.self, forKey: .digitHints) ?? defaults.digitHints
    dictationStandbyMinutes = try container.decodeIfPresent(Int.self, forKey: .dictationStandbyMinutes) ?? defaults.dictationStandbyMinutes
  }
}

/// Settings shared through the App Group. Without Full Access the keyboard cannot
/// read the group, so it falls back to defaults.
public final class SettingsStore: @unchecked Sendable {
  static let key = "keyboardSettings"
  private let defaults: UserDefaults?

  public init(defaults: UserDefaults? = AppGroup.defaults) {
    self.defaults = defaults
  }

  public func load() -> KeyboardSettings {
    guard let data = defaults?.data(forKey: Self.key),
          let settings = try? JSONDecoder().decode(KeyboardSettings.self, from: data) else { return KeyboardSettings() }
    return settings
  }

  public func save(_ settings: KeyboardSettings) {
    guard let data = try? JSONEncoder().encode(settings) else { return }
    defaults?.set(data, forKey: Self.key)
  }
}
