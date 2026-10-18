import Foundation
import Testing
@testable import KeyboardCore

struct ExternalTextTouchR47Tests {
  private func fixture(_ language: String = "en_US", _ initial: String = "") throws -> (KeyboardEngine, MockDocument, LanguageStack) {
    let stack = try LanguageStack(dictionaryURL: Fixtures.languageData.appendingPathComponent(language + ".pkdict"), personalURL: nil, touchURL: nil)
    let document = MockDocument(initial)
    var settings = KeyboardSettings()
    settings.autoCapitalization = false
    settings.autocorrect = false
    let engine = KeyboardEngine(document: document, suggester: stack.suggester, glide: stack.glide, settings: settings)
    document.documentIdentifier = UUID()
    engine.documentDidChange()
    return (engine, document, stack)
  }

  private func expectZeroTouch(_ stack: LanguageStack) {
    #expect(stack.touch.weight.isFinite && stack.touch.weight == 0)
    #expect(stack.touch.offsets.count == 26)
    #expect(stack.touch.offsets.allSatisfy { $0.x.isFinite && $0.y.isFinite && $0 == KeyPoint(x: 0, y: 0) })
  }

  @Test(arguments: ["en_US", "es", "en_es"])
  func emojiKeepsTheSameTapsAsSpace(language: String) throws {
    let word = language == "en_US" ? "music" : "mundo"
    for boundary in [" ", "🎉", "👩🏽‍💻", "❤️", "ℹ️", "1️⃣", "#️⃣", "!", ", next"] {
      let (engine, doc, stack) = try fixture(language)
      engine.type(word)
      engine.insertText(boundary)
      #expect(doc.text == word + boundary)
      #expect(stack.personal.count(of: word) == 1)
      #expect(stack.touch.weight == Double(word.count))
      let weight = stack.touch.weight
      engine.documentDidChange()
      engine.documentDidChange()
      engine.insertText("🎉")
      engine.insertSpace()
      #expect(stack.touch.weight == weight)
      #expect(stack.personal.count(of: word) == 1)
    }
  }

  @Test(arguments: ["s", ".com", "_name", "@host", "/path", "-like", "'s", "’s", "’", "#fragment", "*part", "🏽", "\u{0301}", ""])
  func continuationsNeverTeachThePrefix(suffix: String) throws {
    let (engine, doc, stack) = try fixture()
    engine.type("music")
    engine.insertText(suffix)
    #expect(doc.text == "music" + suffix)
    expectZeroTouch(stack)
    #expect(stack.personal.count(of: "music") == (suffix.isEmpty ? 0 : 1))
  }

  @Test func spacingUsesTheEffectiveBoundary() throws {
    let (engine, doc, stack) = try fixture()
    engine.type("music")
    engine.insertText("notes", spacing: true)
    #expect(doc.text == "music notes")
    #expect(stack.touch.weight == 5)
    #expect(stack.personal.count(of: "music") == 1)
  }

  @Test func newlyLearnedUnknownWordDoesNotValidateItsOwnTaps() throws {
    let (engine, _, stack) = try fixture()
    let unknown = "qzxvplmk"
    #expect(!stack.suggester.isValid(unknown))
    engine.type(unknown)
    engine.insertText("🎉")
    #expect(stack.personal.count(of: unknown) == 1)
    expectZeroTouch(stack)
  }

  @Test(arguments: ["tapless", "disabled", "touch-disabled", "private", "numeric", "url", "identifier", "cursor", "selected", "hidden", "edited"])
  func ineligibleOrUnownedTapsStayExcluded(control: String) throws {
    let (engine, doc, stack) = try fixture()
    if control == "identifier" { engine.insertText("tag_") }
    if control == "tapless" { engine.insertText("music") }
    else { engine.type("music") }
    switch control {
    case "disabled": engine.settings.learnWords = false
    case "touch-disabled": stack.touch.isLearning = false
    case "private": engine.traits.contentType = "email"
    case "numeric": engine.traits.keyboard = .numberPad
    case "url": engine.traits.keyboard = .url
    case "cursor": doc.moveCursor(to: 2)
    case "selected": doc.selectionOverride = "sic"
    case "hidden": doc.hidesContext = true
    case "edited": doc.text = "other"; doc.cursor = doc.text.endIndex
    default: break
    }
    engine.documentDidChange()
    engine.insertText("🎉")
    expectZeroTouch(stack)
  }

  @Test(arguments: ["al", "_tag", ".com", "-like", "/path", "@host"])
  func caretBeforeWordContinuationCannotAcceptFragment(tail: String) throws {
    let (engine, doc, stack) = try fixture("en_US", tail)
    doc.moveCursor(to: 0)
    engine.documentDidChange()
    engine.type("music")
    engine.insertText("🎉")
    #expect(doc.text == "music🎉" + tail)
    expectZeroTouch(stack)
  }

  @Test func hostCreatedSameSpellingDoesNotOwnTheOldTaps() throws {
    let (engine, doc, stack) = try fixture()
    engine.type("music")
    doc.text = "music music"
    doc.cursor = doc.text.endIndex
    engine.documentDidChange()
    engine.insertText("🎉")
    #expect(doc.text == "music music🎉")
    expectZeroTouch(stack)
  }

  @Test func taplessPrefixCannotShiftTheSuffixTaps() throws {
    let (engine, doc, stack) = try fixture("en_US", "mu")
    engine.type("sic")
    engine.insertText("🎉")
    #expect(doc.text == "music🎉")
    #expect(stack.personal.count(of: "music") == 1)
    expectZeroTouch(stack)
  }

  @Test(arguments: ["declined", "missing-tail", "lagging"])
  func uncertainHostAcceptanceDoesNotTeach(control: String) throws {
    let (engine, doc, stack) = try fixture()
    engine.type("music")
    switch control {
    case "declined": doc.declinesInserts = true
    case "missing-tail": doc.hidesAfterContext = true
    default: doc.contextBeforeOverride = "musi"
    }
    engine.insertText("🎉")
    expectZeroTouch(stack)
    doc.declinesInserts = false
    doc.hidesAfterContext = false
    doc.contextBeforeOverride = nil
    engine.documentDidChange()
    engine.documentDidChange()
    expectZeroTouch(stack)
  }

  @Test func pendingCorrectionStillLearnsExactlyOnce() throws {
    let (engine, doc, stack) = try fixture()
    engine.settings.autocorrect = true
    engine.type("teh ")
    #expect(doc.text == "the ")
    expectZeroTouch(stack)
    engine.insertText("🎉")
    #expect(doc.text == "the 🎉")
    #expect(stack.personal.count(of: "the") == 1)
    #expect(stack.touch.weight == 3)
    engine.insertText("🎉")
    engine.documentDidChange()
    #expect(stack.personal.count(of: "the") == 1)
    #expect(stack.touch.weight == 3)
  }

  @Test(arguments: ["identity", "canonical-prefix", "canonical-tail", "private", "unchanged-tail", "own-callback", "canonical-callback-roundtrip"])
  func primitiveMustRetainIdentityAndExactScalarText(control: String) throws {
    let (engine, doc, stack) = try fixture("es", control.contains("tail") ? " cafe\u{0301}" : "")
    engine.clock = { 0 }
    if control.contains("tail") { doc.moveCursor(to: 0); engine.documentDidChange() }
    engine.type("cafe\u{0301}")
    #expect(stack.suggester.isValid("cafe\u{0301}"))
    expectZeroTouch(stack)
    let originalID = doc.documentIdentifier
    doc.onWillEdit = {
      switch control {
      case "identity": doc.documentIdentifier = UUID()
      case "private": engine.traits.isSecure = true
      case "canonical-prefix": doc.text = doc.text.precomposedStringWithCanonicalMapping; doc.cursor = doc.text.endIndex
      case "own-callback": engine.documentDidChange(); engine.documentDidChange()
      case "canonical-callback-roundtrip":
        let original = doc.text
        doc.text = original.precomposedStringWithCanonicalMapping; doc.cursor = doc.text.endIndex
        engine.documentDidChange()
        doc.text = original; doc.cursor = doc.text.endIndex
        engine.documentDidChange()
      case "canonical-tail":
        let prefix = String(doc.text[..<doc.cursor])
        let suffix = String(doc.text[doc.cursor...]).precomposedStringWithCanonicalMapping
        doc.text = prefix + suffix
        doc.moveCursor(to: prefix.count)
      default: break
      }
    }
    engine.insertText("🎉")
    #expect(stack.touch.weight == ((control == "unchanged-tail" || control == "own-callback") ? 3 : 0))
    if control != "unchanged-tail" && control != "own-callback" { expectZeroTouch(stack) }
    if control == "own-callback" {
      let (space, _, ordinary) = try fixture("es")
      space.type("cafe\u{0301}"); space.insertSpace()
      #expect(ordinary.touch.weight == 3)
      #expect(stack.touch.weight == ordinary.touch.weight)
      #expect(stack.touch.offsets == ordinary.touch.offsets)
    }
    #expect(doc.text.distance(from: doc.text.startIndex, to: doc.cursor) == (control.contains("tail") ? 5 : doc.text.count))
    #expect(doc.selectedText == nil)
    let expectedPrefix = (control == "canonical-prefix" ? "café" : "cafe\u{0301}") + "🎉"
    let expectedTail = control == "canonical-tail" ? " café" : control == "unchanged-tail" ? " cafe\u{0301}" : ""
    #expect(doc.text.unicodeScalars.elementsEqual((expectedPrefix + expectedTail).unicodeScalars))
    #expect(stack.personal.count(of: "café") == 1)
    let offsets = stack.touch.offsets
    if control == "identity" { #expect(doc.documentIdentifier != originalID) }
    doc.onWillEdit = nil
    engine.documentDidChange()
    #expect(stack.touch.weight == ((control == "unchanged-tail" || control == "own-callback") ? 3 : 0))
    #expect(stack.touch.offsets == offsets)
  }

  @Test(arguments: ["confirmed", "confirmed-nil", "declined", "identity", "nil-id", "id-nil", "separator", "undo", "declined-known", "kept-known"])
  func onlyConfirmedOwnedSuffixDeletionKeepsEligibility(control: String) throws {
    let (engine, doc, stack) = try fixture()
    if control == "declined-known" || control == "kept-known" {
      engine.type("planes")
      #expect(stack.suggester.isValid("planes"))
      expectZeroTouch(stack)
      let id = doc.documentIdentifier
      if control == "declined-known" {
        let text = doc.text
        let cursor = doc.text.distance(from: doc.text.startIndex, to: doc.cursor)
        doc.declinesDeletes = true
        engine.deleteBackward()
        #expect(doc.text.unicodeScalars.elementsEqual(text.unicodeScalars))
        #expect(doc.text.distance(from: doc.text.startIndex, to: doc.cursor) == cursor)
        #expect(doc.selectedText == nil)
        #expect(doc.documentIdentifier == id)
        doc.declinesDeletes = false
        engine.documentDidChange(); engine.documentDidChange()
        expectZeroTouch(stack)
        // Visible host realignment must not recover the refused occurrence.
        doc.text = "plane"; doc.cursor = doc.text.endIndex
        engine.documentDidChange()
        #expect(stack.suggester.isValid("plane"))
      }
      engine.insertText("🎉")
      if control == "declined-known" { expectZeroTouch(stack) }
      else {
        let (space, _, ordinary) = try fixture()
        space.type("planes"); space.insertSpace()
        #expect(ordinary.touch.weight == 6)
        #expect(stack.touch.weight == ordinary.touch.weight)
        #expect(stack.touch.offsets == ordinary.touch.offsets)
      }
      let offsets = stack.touch.offsets; let weight = stack.touch.weight
      engine.documentDidChange(); engine.insertText("🎉")
      #expect(stack.touch.weight == weight); #expect(stack.touch.offsets == offsets)
      return
    }
    if control == "nil-id" { doc.documentIdentifier = nil; engine.documentDidChange() }
    if control == "undo" {
      engine.settings.autocorrect = true
      engine.type("teh ")
      #expect(doc.text == "the ")
    } else {
      if control == "confirmed-nil" { engine.type("music"); engine.insertCharacter("x") }
      else { engine.type(control == "separator" ? "music " : "musicx") }
    }
    let prior = stack.touch.weight
    let priorOffsets = stack.touch.offsets
    if control == "declined" { doc.declinesDeletes = true }
    if control == "identity" || control == "nil-id" { doc.onWillEdit = { doc.documentIdentifier = UUID() } }
    if control == "id-nil" { doc.onWillEdit = { doc.documentIdentifier = nil } }
    engine.deleteBackward()
    doc.declinesDeletes = false; doc.onWillEdit = nil
    if control == "confirmed" { #expect(doc.text == "music") }
    if control == "undo" { #expect(doc.text == "teh"); #expect(stack.suggester.isValid("teh")) }
    engine.insertText("🎉")
    #expect(stack.touch.weight == prior + (control.hasPrefix("confirmed") ? 5 : 0))
    if !control.hasPrefix("confirmed") { #expect(stack.touch.offsets == priorOffsets) }
    let acceptedOffsets = stack.touch.offsets
    engine.documentDidChange(); engine.documentDidChange(); engine.insertText("🎉")
    #expect(stack.touch.weight == prior + (control.hasPrefix("confirmed") ? 5 : 0))
    #expect(stack.touch.offsets == acceptedOffsets)
  }

  @Test(arguments: ["unchanged", "callback", "poll", "earlier-callback", "earlier-poll", "earlier-exact", "hidden-poll", "window-prefix-poll", "window-suffix-poll", "window-unchanged", "window-own-echo"])
  func observedScalarReplacementCannotReviveOldTaps(control: String) throws {
    if control.hasPrefix("window-") {
      let (engine, doc, stack) = try fixture()
      let (space, _, ordinary) = try fixture()
      engine.clock = { 0 }
      engine.type("music"); space.type("music")
      #expect(stack.suggester.isValid("music"))
      if control != "window-unchanged" {
        doc.text = control == "window-own-echo" ? "musi" : control == "window-prefix-poll" ? "xmusic" : "musicx"
        doc.cursor = doc.text.endIndex
        engine.reconcileHostChanges()
        doc.text = "music"; doc.cursor = doc.text.endIndex
      }
      engine.documentDidChange(); engine.documentDidChange()
      engine.insertText("🎉"); space.insertSpace()
      #expect(doc.text == "music🎉")
      #expect(doc.text.distance(from: doc.text.startIndex, to: doc.cursor) == 6)
      #expect(doc.selectedText == nil)
      #expect(stack.personal.count(of: "music") == 1)
      #expect(ordinary.touch.weight == 5)
      let positive = control == "window-unchanged" || control == "window-own-echo"
      if positive {
        #expect(stack.touch.weight == ordinary.touch.weight)
        #expect(stack.touch.offsets == ordinary.touch.offsets)
      } else { expectZeroTouch(stack) }
      let offsets = stack.touch.offsets
      engine.documentDidChange(); engine.documentDidChange(); engine.insertText("🎉")
      #expect(stack.touch.weight == (positive ? 5 : 0))
      #expect(stack.touch.offsets == offsets)
      #expect(stack.personal.count(of: "music") == 1)
      return
    }
    let (engine, doc, stack) = try fixture("es")
    engine.clock = { 0 }
    engine.type("cafe\u{0301}")
    let earlier = control.hasPrefix("earlier-")
    if earlier { engine.insertCharacter("x") }
    if control == "hidden-poll" {
      doc.hidesContext = true; engine.reconcileHostChanges(); doc.hidesContext = false
    } else if control != "unchanged" {
      doc.text = control == "earlier-exact" ? "cafe\u{0301}" : "café"; doc.cursor = doc.text.endIndex
      if control.contains("poll") { engine.reconcileHostChanges() } else { engine.documentDidChange() }
      doc.text = earlier ? "cafe\u{0301}x" : "cafe\u{0301}"; doc.cursor = doc.text.endIndex
    }
    engine.documentDidChange(); engine.documentDidChange()
    if earlier { engine.deleteBackward() }
    #expect(stack.suggester.isValid("cafe\u{0301}"))
    let positive = control == "unchanged" || control == "earlier-exact"
    engine.insertText("🎉")
    #expect(stack.touch.weight == (positive ? 3 : 0))
    #expect(doc.text.unicodeScalars.elementsEqual("cafe\u{0301}🎉".unicodeScalars))
    #expect(stack.personal.count(of: "café") == 1)
    if !positive { expectZeroTouch(stack) }
  }

  @Test(arguments: ["nil-nil", "nil-id", "id-nil"])
  func liveNullableIdentityMustStayContinuous(control: String) throws {
    let (engine, doc, stack) = try fixture()
    if control.hasPrefix("nil-") { doc.documentIdentifier = nil; engine.documentDidChange() }
    engine.type("music")
    doc.onWillEdit = {
      if control == "nil-id" { doc.documentIdentifier = UUID() }
      if control == "id-nil" { doc.documentIdentifier = nil }
    }
    expectZeroTouch(stack)
    engine.insertText("🎉")
    #expect(doc.text == "music🎉")
    #expect(stack.personal.count(of: "music") == 1)
    #expect(stack.touch.weight == (control == "nil-nil" ? 5 : 0))
    if control != "nil-nil" { expectZeroTouch(stack) }
    let offsets = stack.touch.offsets
    doc.onWillEdit = nil
    engine.documentDidChange(); engine.documentDidChange()
    #expect(stack.touch.weight == (control == "nil-nil" ? 5 : 0))
    #expect(stack.touch.offsets == offsets)
  }

  @Test func sparseOwnedSlotsMatchSpaceWithoutInventingPoints() throws {
    let (space, _, ordinary) = try fixture()
    let (emoji, doc, external) = try fixture()
    for engine in [space, emoji] {
      for c in "ca" {
        let p = LetterGeometry.qwerty.center(String(c).utf8.first!)!
        engine.insertCharacter(String(c), tap: KeyPoint(x: p.x + 0.08, y: p.y + 0.1))
      }
      for c in "noe" { engine.insertCharacter(String(c)) }
      #expect(engine.composing.taps.count == 5)
    }
    space.insertSpace(); emoji.insertText("🛶")
    #expect(doc.text == "canoe🛶")
    #expect(ordinary.touch.weight == 2)
    #expect(external.touch.weight == 2)
    #expect(external.touch.offsets == ordinary.touch.offsets)
  }

  @Test(arguments: ["niño", "café", "cafe\u{0301}"])
  func spanishKeepsExistingAccentTapAlignment(word: String) throws {
    let (space, _, ordinary) = try fixture("es")
    let (emoji, doc, external) = try fixture("es")
    space.type(word)
    emoji.type(word)
    space.insertSpace()
    emoji.insertText("🎉")
    #expect(doc.text == word + "🎉")
    #expect(ordinary.touch.weight > 0)
    #expect(external.touch.weight == ordinary.touch.weight)
    #expect(external.touch.offsets == ordinary.touch.offsets)
    #expect(external.personal.count(of: word) == ordinary.personal.count(of: word))
  }
}
