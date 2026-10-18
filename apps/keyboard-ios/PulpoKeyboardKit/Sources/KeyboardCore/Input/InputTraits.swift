import Foundation

/// The host text field's traits, mirrored from UIKit so the engine stays testable on macOS.
public struct InputTraits: Equatable, Sendable {
  public enum Keyboard: Sendable {
    case standard, email, url, webSearch, twitter, numberPad, decimalPad, phonePad, numbersAndPunctuation, asciiCapable
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

  // Exact UIKit raw values, calibrated from named constants on iOS. Keep the
  // programmer-name aliases below for existing platform-free callers. Unknown
  // custom content types are opaque: punctuation and case are significant.
  static let privateContentTypes: Set<String> = [
    "new-password", "one-time-code", "email", "url", "tel", "cc-number", "cc-csc",
    "cc-exp", "cc-exp-month", "cc-exp-year", "cc-name", "cc-given-name", "cc-family-name",
    "cc-additional-name", "cc-type", "postal-code", "flight-number", "shipment-tracking-number",
    "bday", "bday-day", "bday-month", "bday-year",
    // Legacy symbolic aliases (username and password already equal UIKit raw values).
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

  public var isNumeric: Bool { keyboard == .numberPad || keyboard == .decimalPad || keyboard == .phonePad }
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
  /// Spaces owed around swiped words. Addresses, identifiers and secrets never get them.
  public var autoSpaces: Bool
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
    autoSpaces = plain
    allowsGlide = settings.swipeTyping && !traits.isNumeric && !traits.isSecure
  }
}
