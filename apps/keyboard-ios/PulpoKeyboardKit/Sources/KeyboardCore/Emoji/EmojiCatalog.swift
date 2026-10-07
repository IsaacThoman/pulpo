import Foundation

public struct Emoji: Decodable, Equatable, Hashable, Sendable {
  public let value: String
  public let name: String
  /// Unicode emoji version that introduced it.
  public let version: Double
  /// Light through dark skin tone variants, when the emoji has them.
  public let tones: [String]?

  enum CodingKeys: String, CodingKey {
    case value = "e", name = "n", version = "v", tones = "t"
  }

  public init(value: String, name: String, version: Double, tones: [String]?) {
    self.value = value
    self.name = name
    self.version = version
    self.tones = tones
  }
}

public struct EmojiCategory: Decodable, Equatable, Sendable {
  public let id: String
  public let name: String
  public let emoji: [Emoji]
}

public struct EmojiCatalog: Decodable, Sendable {
  public let version: String
  public let categories: [EmojiCategory]

  public static func load(url: URL) throws -> EmojiCatalog {
    try JSONDecoder().decode(EmojiCatalog.self, from: Data(contentsOf: url))
  }

  /// Keeps only emoji the current OS can draw as a single glyph.
  public func filtered(_ isSupported: (Emoji) -> Bool) -> EmojiCatalog {
    EmojiCatalog(version: version, categories: categories.map { category in
      EmojiCategory(id: category.id, name: category.name, emoji: category.emoji.filter(isSupported))
    })
  }

  init(version: String, categories: [EmojiCategory]) {
    self.version = version
    self.categories = categories
  }
}

/// Recently used emoji and each emoji's chosen skin tone.
public final class EmojiHistory {
  public static let limit = 32
  private let defaults: UserDefaults
  public private(set) var recents: [String]
  private var tones: [String: String]

  public init(defaults: UserDefaults) {
    self.defaults = defaults
    recents = defaults.stringArray(forKey: "emojiRecents") ?? []
    tones = defaults.dictionary(forKey: "emojiTones") as? [String: String] ?? [:]
  }

  public func use(_ emoji: String) {
    recents.removeAll { $0 == emoji }
    recents.insert(emoji, at: 0)
    if recents.count > Self.limit { recents.removeLast(recents.count - Self.limit) }
    defaults.set(recents, forKey: "emojiRecents")
  }

  /// The variant to insert for `base`, remembering the last tone picked.
  public func preferred(for base: Emoji) -> String {
    guard base.tones != nil, let tone = tones[base.value] else { return base.value }
    return tone
  }

  public func setPreferred(_ variant: String, for base: Emoji) {
    tones[base.value] = variant == base.value ? nil : variant
    defaults.set(tones, forKey: "emojiTones")
  }
}
