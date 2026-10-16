import Foundation

/// Explicit local typing modes. Bilingual mode searches both vocabularies; it
/// does not translate text or infer a preferred language from private content.
public enum KeyboardLanguage: String, Codable, CaseIterable, Sendable {
  case english = "en_US"
  case spanish = "es"
  case bilingual = "en_es"

  public var title: String {
    switch self {
    case .english: "English"
    case .spanish: "Español"
    case .bilingual: "English + Español"
    }
  }

  public var primaryLanguage: String {
    self == .spanish ? "es" : "en-US"
  }
}
