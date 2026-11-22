import CoreGraphics

/// Key names of protocol.ts to macOS virtual key codes. Characters use the US ANSI layout: a chord
/// names a physical key (`cmd+s` is the key that types `s` there). Text the agent types does not
/// go through this table; it is sent as text, so any character works on any layout.
enum Keys {
  struct Chord {
    let code: CGKeyCode
    let flags: CGEventFlags
    /// For a character the US layout cannot type, the character itself, sent as text with the flags.
    let text: String?
  }

  static let returnKey: CGKeyCode = 36
  static let tabKey: CGKeyCode = 48

  private static let named: [String: CGKeyCode] = [
    "enter": 36, "return": 36, "escape": 53, "esc": 53, "tab": 48, "space": 49, "backspace": 51,
    // `delete` is the key that deletes forward, as on Windows; the Mac's own Delete key is `backspace`.
    "delete": 117, "forwarddelete": 117, "del": 117,
    "up": 126, "down": 125, "left": 123, "right": 124, "arrowup": 126, "arrowdown": 125, "arrowleft": 123, "arrowright": 124,
    "home": 115, "end": 119, "pageup": 116, "pagedown": 121, "pgup": 116, "pgdn": 121, "help": 114, "insert": 114,
    "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100, "f9": 101, "f10": 109,
    "f11": 103, "f12": 111, "f13": 105, "f14": 107, "f15": 113, "f16": 106, "f17": 64, "f18": 79, "f19": 80, "f20": 90,
    "plus": 24, "minus": 27,
  ]
  /// Keys whose real presses carry the Fn flag (and the arrows the numeric pad flag); some apps check.
  private static let functionKeys: Set<CGKeyCode> = [117, 126, 125, 123, 124, 115, 119, 116, 121, 114, 122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111, 105, 107, 113, 106, 64, 79, 80, 90]
  private static let arrowKeys: Set<CGKeyCode> = [123, 124, 125, 126]

  private static let characters: [Character: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13,
    "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25,
    "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38,
    "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "`": 50, " ": 49,
  ]
  /// Characters typed with Shift on the US layout, and the key that types them.
  private static let shifted: [Character: Character] = [
    "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
    "_": "-", "+": "=", "{": "[", "}": "]", "|": "\\", ":": ";", "\"": "'", "<": ",", ">": ".", "?": "/", "~": "`",
  ]

  static let modifierCodes: [(flag: CGEventFlags, code: CGKeyCode)] = [
    (.maskCommand, 55), (.maskShift, 56), (.maskAlternate, 58), (.maskControl, 59),
  ]

  static func parse(_ keys: String) throws -> Chord {
    let trimmed = keys.trimmingCharacters(in: .whitespaces)
    guard !trimmed.isEmpty else { throw ControlError.invalidRequest("`keys` is empty.") }
    // `+` joins the parts, so a chord ending in the plus key itself ends in `++`.
    var parts: [String]
    if trimmed == "+" {
      parts = ["+"]
    } else if trimmed.hasSuffix("++") {
      parts = trimmed.dropLast(2).split(separator: "+", omittingEmptySubsequences: false).map(String.init) + ["+"]
    } else {
      parts = trimmed.split(separator: "+", omittingEmptySubsequences: false).map(String.init)
    }
    parts = parts.map { $0.trimmingCharacters(in: .whitespaces) }
    guard let key = parts.popLast(), !key.isEmpty, !parts.contains(where: \.isEmpty) else {
      throw ControlError.invalidRequest("`\(keys)` is not a key or chord.")
    }

    var flags: CGEventFlags = []
    for modifier in parts {
      switch modifier.lowercased() {
      case "cmd", "command", "meta", "super", "win": flags.insert(.maskCommand)
      case "ctrl", "control": flags.insert(.maskControl)
      case "alt", "option", "opt": flags.insert(.maskAlternate)
      case "shift": flags.insert(.maskShift)
      default: throw ControlError.invalidRequest("`\(modifier)` in `\(keys)` is not cmd, ctrl, alt or shift.")
      }
    }

    if let code = named[key.lowercased()] {
      var keyFlags = flags
      if functionKeys.contains(code) { keyFlags.insert(.maskSecondaryFn) }
      if arrowKeys.contains(code) { keyFlags.insert(.maskNumericPad) }
      return Chord(code: code, flags: keyFlags, text: nil)
    }
    guard key.count == 1, let character = key.first else {
      throw ControlError.invalidRequest("`\(key)` is not a key name or a single character.")
    }
    if let code = characters[character] { return Chord(code: code, flags: flags, text: nil) }
    if character.isUppercase, let lower = character.lowercased().first, let code = characters[lower] {
      return Chord(code: code, flags: flags.union(.maskShift), text: nil)
    }
    if let base = shifted[character], let code = characters[base] {
      return Chord(code: code, flags: flags.union(.maskShift), text: nil)
    }
    // A character the US layout has no key for (é, ß): sent as that character, which types it but
    // may not trigger a shortcut that expects a physical key.
    return Chord(code: 0, flags: flags, text: key)
  }
}
