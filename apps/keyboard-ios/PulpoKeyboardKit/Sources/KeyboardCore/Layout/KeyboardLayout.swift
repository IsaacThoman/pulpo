import Foundation

public enum KeyAction: Equatable, Sendable {
  case character(String)
  case shift
  case delete
  case page(KeyboardPage)
  case space
  case returnKey
  case emoji
  case nextKeyboard
  /// Fixed text such as ".com".
  case text(String)
}

public struct Key: Equatable, Sendable {
  public enum Style: Equatable, Sendable {
    /// Light keys: letters, digits, symbols, space.
    case input
    /// Darker keys: shift, delete, page switches, emoji, globe.
    case function
    case returnKey
  }

  public var action: KeyAction
  public var label: String
  /// Width in letter-key pitches; ignored for flexible keys.
  public var width: Double
  public var flexible: Bool
  public var alternates: [String]
  /// A small secondary label (digit hints, phone pad letters).
  public var hint: String?
  public var style: Style
  public var identifier: String

  public init(action: KeyAction, label: String, width: Double = 1, flexible: Bool = false, alternates: [String] = [], hint: String? = nil, style: Style = .input, identifier: String? = nil) {
    self.action = action
    self.label = label
    self.width = width
    self.flexible = flexible
    self.alternates = alternates
    self.hint = hint
    self.style = style
    self.identifier = identifier ?? "key-\(label)"
  }

  public var isCharacter: Bool {
    if case .character = action { return true }
    return false
  }
}

public struct KeyRow: Equatable, Sendable {
  public var keys: [Key]
  /// Empty space before the first key, in pitches (the ASDF row is inset half a key).
  public var inset: Double
  /// Extra gap after the first key and before the last (shift and delete stand apart).
  public var edgeGap: Double

  public init(keys: [Key], inset: Double = 0, edgeGap: Double = 0) {
    self.keys = keys
    self.inset = inset
    self.edgeGap = edgeGap
  }
}

public struct KeyboardLayout: Equatable, Sendable {
  public var rows: [KeyRow]
  public var isNumberPad: Bool

  public static let accents: [String: [String]] = [
    "a": ["à", "á", "â", "ä", "æ", "ã", "å", "ā"],
    "c": ["ç", "ć", "č"],
    "e": ["è", "é", "ê", "ë", "ē", "ė", "ę"],
    "i": ["î", "ï", "í", "ī", "į", "ì"],
    "l": ["ł"],
    "n": ["ñ", "ń"],
    "o": ["ô", "ö", "ò", "ó", "œ", "ø", "ō", "õ"],
    "s": ["ß", "ś", "š"],
    "u": ["û", "ü", "ù", "ú", "ū"],
    "y": ["ÿ"],
    "z": ["ž", "ź", "ż"],
  ]

  public static let symbolAlternates: [String: [String]] = [
    "0": ["°"], "-": ["–", "—", "•"], "/": ["\\"], "$": ["₽", "¥", "€", "¢", "£", "₩"], "&": ["§"],
    "\"": ["„", "“", "”", "«", "»"], ".": ["…"], "?": ["¿"], "!": ["¡"], "'": ["‘", "’", "`"], "%": ["‰"],
  ]

  public static func returnLabel(for kind: InputTraits.Return) -> String {
    switch kind {
    case .default: "return"
    case .go: "go"
    case .search: "search"
    case .join: "join"
    case .next: "next"
    case .route: "route"
    case .send: "send"
    case .done: "done"
    case .emergencyCall: "Emergency"
    case .continue: "continue"
    }
  }

  public static func make(page: KeyboardPage, traits: InputTraits, needsGlobe: Bool, digitHints: Bool) -> KeyboardLayout {
    if traits.isNumeric { return numberPad(decimal: traits.keyboard == .decimalPad, needsGlobe: needsGlobe) }
    let top: [KeyRow]
    switch page {
    case .letters: top = letterRows(digitHints: digitHints)
    case .numbers: top = numberRows(symbols: false)
    case .symbols: top = numberRows(symbols: true)
    }
    return KeyboardLayout(rows: top + [bottomRow(page: page, traits: traits, needsGlobe: needsGlobe)], isNumberPad: false)
  }

  static func letterRows(digitHints: Bool) -> [KeyRow] {
    let digits = Array("1234567890").map(String.init)
    let first = Array("qwertyuiop").enumerated().map { index, letter -> Key in
      let name = String(letter)
      var alternates = accents[name] ?? []
      if digitHints { alternates.insert(digits[index], at: 0) }
      return Key(action: .character(name), label: name, alternates: alternates, hint: digitHints ? digits[index] : nil)
    }
    let second = Array("asdfghjkl").map { Key(action: .character(String($0)), label: String($0), alternates: accents[String($0)] ?? []) }
    var third = [Key(action: .shift, label: "shift", width: 1.25, style: .function, identifier: "key-shift")]
    third += Array("zxcvbnm").map { Key(action: .character(String($0)), label: String($0), alternates: accents[String($0)] ?? []) }
    third.append(Key(action: .delete, label: "delete", width: 1.25, style: .function, identifier: "key-delete"))
    return [KeyRow(keys: first), KeyRow(keys: second, inset: 0.5), KeyRow(keys: third, edgeGap: 0.25)]
  }

  static func numberRows(symbols: Bool) -> [KeyRow] {
    let rows = symbols
      ? ["[]{}#%^*+=", "_\\|~<>€£¥•"]
      : ["1234567890", "-/:;()$&@\""]
    let built = rows.map { row in
      KeyRow(keys: row.map { character in
        let text = String(character)
        return Key(action: .character(text), label: text, alternates: symbolAlternates[text] ?? [])
      })
    }
    var third = [symbols
      ? Key(action: .page(.numbers), label: "123", width: 1.25, style: .function, identifier: "key-numbers")
      : Key(action: .page(.symbols), label: "#+=", width: 1.25, style: .function, identifier: "key-symbols")]
    // Five wider punctuation keys share the row, as on the system keyboard.
    third += [".", ",", "?", "!", "'"].map { Key(action: .character($0), label: $0, width: 1.4, alternates: symbolAlternates[$0] ?? []) }
    third.append(Key(action: .delete, label: "delete", width: 1.25, style: .function, identifier: "key-delete"))
    return built + [KeyRow(keys: third, edgeGap: 0.25)]
  }

  static func bottomRow(page: KeyboardPage, traits: InputTraits, needsGlobe: Bool) -> KeyRow {
    var keys: [Key] = [page == .letters
      ? Key(action: .page(.numbers), label: "123", width: 1.25, style: .function, identifier: "key-numbers")
      : Key(action: .page(.letters), label: "ABC", width: 1.25, style: .function, identifier: "key-letters")]
    if needsGlobe { keys.append(Key(action: .nextKeyboard, label: "globe", width: 1.25, style: .function, identifier: "key-globe")) }
    if traits.keyboard != .asciiCapable {
      keys.append(Key(action: .emoji, label: "emoji", width: 1.25, style: .function, identifier: "key-emoji"))
    }
    let space = Key(action: .space, label: "space", flexible: true, identifier: "key-space")
    switch traits.keyboard {
    case .email:
      keys += [space, Key(action: .character("@"), label: "@"), Key(action: .character("."), label: ".")]
    case .url:
      keys += [
        Key(action: .character("."), label: ".", flexible: true),
        Key(action: .character("/"), label: "/", flexible: true),
        Key(action: .text(".com"), label: ".com", flexible: true, alternates: [".net", ".org", ".edu", ".us", ".co"], identifier: "key-dotcom"),
      ]
    case .twitter:
      keys += [space, Key(action: .character("@"), label: "@"), Key(action: .character("#"), label: "#")]
    case .webSearch:
      keys += [space, Key(action: .character("."), label: ".")]
    default:
      keys.append(space)
    }
    keys.append(Key(action: .returnKey, label: returnLabel(for: traits.returnKey), width: 2.5, style: .returnKey, identifier: "key-return"))
    return KeyRow(keys: keys)
  }

  static func numberPad(decimal: Bool, needsGlobe: Bool) -> KeyboardLayout {
    let letters = ["", "ABC", "DEF", "GHI", "JKL", "MNO", "PQRS", "TUV", "WXYZ"]
    var rows: [KeyRow] = []
    for row in 0..<3 {
      rows.append(KeyRow(keys: (1...3).map { column in
        let digit = row * 3 + column
        return Key(action: .character(String(digit)), label: String(digit), hint: letters[digit - 1].isEmpty ? nil : letters[digit - 1])
      }))
    }
    let corner: Key = decimal
      ? Key(action: .character("."), label: ".")
      : needsGlobe ? Key(action: .nextKeyboard, label: "globe", style: .function, identifier: "key-globe")
      : Key(action: .text(""), label: "", style: .function, identifier: "key-blank")
    rows.append(KeyRow(keys: [corner, Key(action: .character("0"), label: "0"), Key(action: .delete, label: "delete", style: .function, identifier: "key-delete")]))
    return KeyboardLayout(rows: rows, isNumberPad: true)
  }
}
