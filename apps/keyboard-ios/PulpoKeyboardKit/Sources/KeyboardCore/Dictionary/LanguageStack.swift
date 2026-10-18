import Foundation

/// Everything that turns keystrokes and swipes into words, built from one dictionary file.
public final class LanguageStack {
  public let lexicon: Lexicon
  public let personal: PersonalDictionary
  public let model: LanguageModel
  public let corrector: SpellCorrector
  public let suggester: Suggester
  public let glide: GlideDecoder

  public let touch: TouchModel

  public init(dictionaryURL: URL, personalURL: URL?, touchURL: URL? = nil) throws {
    let personal = PersonalDictionary(url: personalURL)
    let touch = TouchModel(url: touchURL)
    lexicon = try Lexicon(url: dictionaryURL)
    self.personal = personal
    self.touch = touch
    model = LanguageModel(lexicon: lexicon, personal: personal)
    corrector = SpellCorrector(lexicon: lexicon)
    corrector.touch = touch
    suggester = Suggester(model: model, corrector: corrector)
    glide = GlideDecoder(model: model)
  }

  /// Language changes share learned words, contact names and tap calibration.
  /// No second personal dictionary writer is created for the same storage URL.
  public init(dictionaryURL: URL, sharing previous: LanguageStack) throws {
    lexicon = try Lexicon(url: dictionaryURL)
    personal = previous.personal
    model = LanguageModel(lexicon: lexicon, personal: personal)
    corrector = SpellCorrector(lexicon: lexicon)
    touch = previous.touch
    corrector.touch = touch
    suggester = Suggester(model: model, corrector: corrector)
    suggester.textReplacements = previous.suggester.textReplacements
    glide = GlideDecoder(model: model)
    setGeometry(previous.corrector.geometry)
  }

  /// Applies the live key centers to both spatial models.
  public func setGeometry(_ geometry: LetterGeometry) {
    corrector.geometry = geometry
    glide.geometry = geometry
  }
}
