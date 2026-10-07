#if os(iOS)
import UIKit

/// What the keyboard needs from wherever it runs: the extension's input view
/// controller, or the app's in-app preview.
public protocol KeyboardHost: AnyObject {
  var document: TextDocument { get }
  var inputTraits: InputTraits { get }
  var needsInputModeSwitchKey: Bool { get }
  var hasFullAccess: Bool { get }
  /// Whether the keyboard runs inside Pulpo Keyboard itself, so dictation needs no app switch.
  var isInsideApp: Bool { get }
  func advanceToNextInputMode()
  func handleInputModeList(from view: UIView, with event: UIEvent)
  func adjustTextPosition(byCharacterOffset offset: Int)
  func openApp(_ url: URL)
  /// The app being typed in, when iOS still reveals it (before iOS 26.4).
  var hostBundleIdentifier: String? { get }
}

extension KeyboardHost {
  public var hostBundleIdentifier: String? { nil }
}

/// Adapts the system text proxy to the engine's document protocol.
public final class ProxyDocument: TextDocument {
  let proxy: UITextDocumentProxy

  public init(proxy: UITextDocumentProxy) {
    self.proxy = proxy
  }

  public var documentContextBeforeInput: String? { proxy.documentContextBeforeInput }
  public var documentContextAfterInput: String? { proxy.documentContextAfterInput }
  public var selectedText: String? { proxy.selectedText }
  public var hasText: Bool { proxy.hasText }
  public func insertText(_ text: String) { proxy.insertText(text) }
  public func deleteBackward() { proxy.deleteBackward() }
}

extension InputTraits {
  /// Reads UIKit text traits into the engine's platform-free form.
  public init(_ source: UITextInputTraits) {
    self.init()
    switch source.keyboardType ?? .default {
    case .emailAddress: keyboard = .email
    case .URL: keyboard = .url
    case .webSearch: keyboard = .webSearch
    case .twitter: keyboard = .twitter
    case .numberPad, .asciiCapableNumberPad, .phonePad, .namePhonePad: keyboard = .numberPad
    case .decimalPad: keyboard = .decimalPad
    case .numbersAndPunctuation: keyboard = .numbersAndPunctuation
    case .asciiCapable: keyboard = .asciiCapable
    default: keyboard = .standard
    }
    switch source.autocapitalizationType ?? .sentences {
    case .none: capitalization = .none
    case .words: capitalization = .words
    case .allCharacters: capitalization = .allCharacters
    default: capitalization = .sentences
    }
    switch source.autocorrectionType ?? .default {
    case .no: autocorrection = false
    case .yes: autocorrection = true
    default: autocorrection = nil
    }
    switch source.spellCheckingType ?? .default {
    case .no: spellChecking = false
    case .yes: spellChecking = true
    default: spellChecking = nil
    }
    switch source.returnKeyType ?? .default {
    case .go: returnKey = .go
    case .google, .search, .yahoo: returnKey = .search
    case .join: returnKey = .join
    case .next: returnKey = .next
    case .route: returnKey = .route
    case .send: returnKey = .send
    case .done: returnKey = .done
    case .emergencyCall: returnKey = .emergencyCall
    case .continue: returnKey = .continue
    default: returnKey = .default
    }
    enablesReturnKeyAutomatically = source.enablesReturnKeyAutomatically ?? false
    isSecure = source.isSecureTextEntry ?? false
    contentType = source.textContentType??.rawValue
    if let smart = source.smartQuotesType { smartQuotes = smart == .no ? false : nil }
    if let smart = source.smartDashesType { smartDashes = smart == .no ? false : nil }
    if let appearance = source.keyboardAppearance { prefersDarkAppearance = appearance == .dark ? true : nil }
  }
}

/// Key haptics. Generators are attached to the keyboard's view (unattached ones can stay
/// silent in an extension) and kept prepared so the Taptic Engine fires on touch down.
final class KeyboardFeedback {
  /// The keyboard on screen; panels and bars reach haptics through it.
  static weak var current: KeyboardFeedback?

  var enabled = true { didSet { if enabled { prepare() } } }
  private let light: UIImpactFeedbackGenerator
  private let medium: UIImpactFeedbackGenerator

  init(view: UIView) {
    light = UIImpactFeedbackGenerator(style: .light, view: view)
    medium = UIImpactFeedbackGenerator(style: .medium, view: view)
  }

  func prepare() {
    guard enabled else { return }
    light.prepare()
    medium.prepare()
  }

  /// A key press. Function keys tap a little softer, like the system keyboard.
  func key(function: Bool = false) {
    guard enabled else { return }
    light.impactOccurred(intensity: function ? 0.8 : 1)
    light.prepare()
  }

  /// Long presses, alternates, and mode changes.
  func emphasis() {
    guard enabled else { return }
    medium.impactOccurred(intensity: 0.9)
    medium.prepare()
  }

  /// Each step of space-bar cursor movement.
  func tick() {
    guard enabled else { return }
    light.impactOccurred(intensity: 0.45)
    light.prepare()
  }
}
#endif
