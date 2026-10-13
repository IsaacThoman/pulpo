import Foundation
import Testing
@testable import KeyboardCore

struct LanguageModelConfidenceTests {
  @Test(arguments: [("to", "the"), ("is", "the"), ("in", "the")])
  func omittedContinuationsKeepTheirLowerOrderEvidence(preceding: String, previous: String) throws {
    let (model, _, _) = Fixtures.stack()
    let context = model.context(previousWord: previous, sentenceStart: false, precedingWord: preceding)
    let history = try #require(context.trigram)
    let common = try #require(model.lexicon.id(of: "meeting"))
    let rare = try #require(model.lexicon.id(of: "abaft"))
    let retained = model.lexicon.trigramSuccessors(of: history).map { model.lexicon.trigramSuccessor(at: $0).id }
    #expect(!retained.contains(common))
    #expect(!retained.contains(rare))
    #expect(model.lexicon.trigramWeight(of: history) < 1)
    let commonScore = model.logProbability(of: "meeting", id: common, in: context)
    let rareScore = model.logProbability(of: "abaft", id: rare, in: context)
    #expect(commonScore > LanguageModel.floor)
    #expect(commonScore > rareScore + 4)
  }

  @Test func typoRankingUsesBackoffWithoutReplacingTheValidLiteral() throws {
    let (model, suggester, _) = Fixtures.stack()
    let context = model.context(previousWord: "the", sentenceStart: false, precedingWord: "is")
    let candidates = suggester.candidates(for: TypedWord(text: "meting"), context: context)
    let meeting = try #require(candidates.first { $0.text == "meeting" })
    let meting = try #require(candidates.first { $0.text == "meting" })
    #expect(meeting.score > meting.score)
    let literal = suggester.suggestions(for: TypedWord(text: "meting"), context: context, autocorrect: true)
    #expect(literal.autocorrection == nil)
    #expect(literal.slots.contains { $0.text == "meting" && $0.kind == .literal })
  }

  @Test func missingTrigramContinuationStillRecoversAnOrdinaryTypo() {
    let (model, suggester, _) = Fixtures.stack()
    let context = model.context(previousWord: "the", sentenceStart: false, precedingWord: "on")
    let word = TypedWord(text: "keybaord")
    #expect(suggester.suggestions(for: word, context: context, autocorrect: true).autocorrection == "keyboard")
  }
}
