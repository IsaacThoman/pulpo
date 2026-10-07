import Foundation

/// Everything that turns keystrokes and swipes into words, built from one dictionary file.
public final class LanguageStack {
  public let lexicon: Lexicon
  public let personal: PersonalDictionary
  public let model: LanguageModel
  public let corrector: SpellCorrector
  public let suggester: Suggester
  public let glide: GlideDecoder

  public init(dictionaryURL: URL, personalURL: URL?) throws {
    lexicon = try Lexicon(url: dictionaryURL)
    personal = PersonalDictionary(url: personalURL)
    model = LanguageModel(lexicon: lexicon, personal: personal)
    corrector = SpellCorrector(lexicon: lexicon)
    suggester = Suggester(model: model, corrector: corrector)
    glide = GlideDecoder(model: model)
  }

  /// Applies the live key centers to both spatial models.
  public func setGeometry(_ geometry: LetterGeometry) {
    corrector.geometry = geometry
    glide.geometry = geometry
  }
}
