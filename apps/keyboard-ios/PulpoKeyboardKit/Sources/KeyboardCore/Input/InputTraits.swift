import Foundation

/// The host text field's traits, mirrored from UIKit so the engine stays testable on macOS.
public struct InputTraits: Equatable, Sendable {
  public enum Keyboard: Sendable {
    case standard, email, url, webSearch, twitter, numberPad, decimalPad, numbersAndPunctuation, asciiCapable
  }

  public enum Capitalization: Sendable {
    case none, words, sentences, allCharacters
  }

  public enum Return: Sendable {
    case `default`, go, search, join, next, route, send, done, emergencyCall, `continue`
  }

  public var keyboard: Keyboard = .standard
  public var capitalization: Capitalization = .sentences
  /// `nil` means the field left it to the keyboard's default.
  public var autocorrection: Bool?
  public var spellChecking: Bool?
  public var returnKey: Return = .default
  public var enablesReturnKeyAutomatically = false
  public var isSecure = false
  /// A `UITextContentType` raw value.
  public var contentType: String?
  public var smartQuotes: Bool?
  public var smartDashes: Bool?
  public var prefersDarkAppearance: Bool?

  public init() {}

  static let privateContentTypes: Set<String> = [
    "username", "password", "newPassword", "oneTimeCode", "emailAddress", "URL", "telephoneNumber",
    "creditCardNumber", "creditCardSecurityCode", "creditCardExpiration", "creditCardExpirationMonth",
    "creditCardExpirationYear", "creditCardName", "creditCardGivenName", "creditCardFamilyName",
    "creditCardMiddleName", "creditCardType", "postalCode", "flightNumber", "shipmentTrackingNumber",
    "birthdate", "birthdateDay", "birthdateMonth", "birthdateYear",
  ]

  /// Fields whose contents must not be learned or second-guessed.
  public var isPrivate: Bool {
    isSecure || contentType.map(Self.privateContentTypes.contains) == true
  }

  public var isNumeric: Bool { keyboard == .numberPad || keyboard == .decimalPad }
}

/// What the engine is allowed to do in the current field.
public struct InputPolicy: Equatable, Sendable {
  public var autocorrects: Bool
  public var appliesTextReplacements: Bool
  public var showsSuggestions: Bool
  public var learns: Bool
  public var capitalization: InputTraits.Capitalization
  public var smartQuotes: Bool
  public var smartSpacing: Bool
  public var allowsGlide: Bool

  public init(traits: InputTraits, settings: KeyboardSettings) {
    let addressLike = traits.keyboard == .email || traits.keyboard == .url
    let plain = !traits.isPrivate && !addressLike && !traits.isNumeric
    autocorrects = plain && settings.autocorrect && traits.autocorrection != false
    appliesTextReplacements = plain && traits.autocorrection != false
    showsSuggestions = plain && settings.predictions
    learns = plain && settings.learnWords
    capitalization = settings.autoCapitalization && !addressLike ? traits.capitalization : .none
    smartQuotes = settings.smartPunctuation && traits.smartQuotes != false && plain
    smartSpacing = settings.smartPunctuation && plain
    allowsGlide = settings.swipeTyping && !traits.isNumeric && !traits.isSecure
  }
}
