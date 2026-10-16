import Foundation

/// The text typed into the emoji picker's search field. A keyboard can't focus a
/// text field inside its own view, so the field shows this buffer and the
/// keyboard's letter keys edit it; nothing reaches the document until an emoji
/// is picked.
public struct EmojiSearchQuery: Equatable, Sendable {
  public static let maximumLength = 40
  public private(set) var text = ""

  public init(_ text: String = "") {
    append(text)
  }

  public var isEmpty: Bool { text.isEmpty }

  /// Appends typed text. Spaces separate words: a leading space or a second
  /// space in a row adds nothing, and any other whitespace counts as a space.
  public mutating func append(_ typed: String) {
    for character in typed {
      if character.isWhitespace {
        guard let last = text.last, last != " " else { continue }
        text.append(" ")
      } else {
        text.append(character)
      }
      if text.count >= Self.maximumLength { break }
    }
  }

  public mutating func deleteBackward() {
    if !text.isEmpty { text.removeLast() }
  }

  /// Removes `count` words from the end, with the spaces before them.
  public mutating func deleteWordsBackward(_ count: Int) {
    for _ in 0..<max(0, count) {
      while text.last == " " { text.removeLast() }
      while let last = text.last, last != " " { text.removeLast() }
      while text.last == " " { text.removeLast() }
    }
  }

  public mutating func clear() {
    text = ""
  }
}

/// One emoji shown in the search results strip.
public struct EmojiSearchResult: Equatable, Sendable {
  /// What is shown and inserted: the person's skin tone, or the recent variant.
  public let value: String
  public let base: Emoji

  public init(value: String, base: Emoji) {
    self.value = value
    self.base = base
  }

  public var name: String { base.name }
}

public enum EmojiSearch {
  public static let resultLimit = 48
  /// Shown after recents when there are few, so the strip is never blank.
  public static let popular = [
    "😂", "❤️", "🥰", "😍", "😊", "🙏", "😭", "👍", "😘", "🔥", "🥺", "😅",
    "🎉", "😁", "💕", "🤣", "😉", "👏", "💯", "✨", "😎", "🤔", "🙌", "😢",
  ]

  /// Results for `query`: matching emoji in the person's skin tones, or, for an
  /// empty query, recent emoji followed by popular ones.
  public static func results(for query: EmojiSearchQuery, suggester: EmojiSuggester, history: EmojiHistory?, limit: Int = resultLimit) -> [EmojiSearchResult] {
    let terms = query.text.trimmingCharacters(in: .whitespaces)
    guard terms.isEmpty else {
      // The person's recent emoji, then everyone's, break ties between matches.
      var preferred = Dictionary(popular.map { ($0, 1) }, uniquingKeysWith: max)
      for value in history?.recents ?? [] { if let base = suggester.emoji(for: value) { preferred[base.value] = 2 } }
      return suggester.search(terms, limit: limit, preferring: preferred).map {
        EmojiSearchResult(value: history?.preferred(for: $0) ?? $0.value, base: $0)
      }
    }
    var results: [EmojiSearchResult] = []
    var seen: Set<String> = []
    for value in history?.recents ?? [] {
      guard results.count < limit, let base = suggester.emoji(for: value), seen.insert(base.value).inserted else { continue }
      results.append(EmojiSearchResult(value: value, base: base))
    }
    for value in popular {
      guard results.count < limit, let base = suggester.emoji(for: value), seen.insert(base.value).inserted else { continue }
      results.append(EmojiSearchResult(value: history?.preferred(for: base) ?? base.value, base: base))
    }
    return results
  }
}
