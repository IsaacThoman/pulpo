import Foundation
@main struct Witness {
 static let locale = Locale(identifier: "en_US_POSIX")
 static func legacy(_ text: String) -> String {
   text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: locale).unicodeScalars.map {
     CharacterSet.alphanumerics.contains($0) ? String($0) : (($0 == "'" || $0 == "\u{2019}") ? "" : " ")
   }.joined().split(whereSeparator: \.isWhitespace).joined(separator: " ")
 }
 static func canonical(_ text: String) -> [String] {
   var out = ""; var vowel = false
   for scalar in text.lowercased(with: locale).decomposedStringWithCanonicalMapping.unicodeScalars {
     switch scalar.properties.generalCategory {
     case .nonspacingMark, .spacingMark, .enclosingMark:
       if !vowel { out.unicodeScalars.append(scalar) }
     default:
       vowel = "aeiou".unicodeScalars.contains(scalar)
       out.unicodeScalars.append(scalar)
     }
   }
   let recomposed = out.precomposedStringWithCanonicalMapping
   return Array(Set(recomposed.split { c in c.unicodeScalars.contains { s in
     switch s.properties.generalCategory {
     case .connectorPunctuation, .dashPunctuation, .openPunctuation, .closePunctuation, .initialPunctuation, .finalPunctuation, .otherPunctuation, .mathSymbol, .currencySymbol, .modifierSymbol, .otherSymbol, .decimalNumber, .letterNumber, .otherNumber, .spaceSeparator, .lineSeparator, .paragraphSeparator: return true
     default: return s.properties.isWhitespace
     }
   } }.map(String.init))).sorted()
 }
 static func project(_ text: String) -> String {
   let folded = text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: locale).decomposedStringWithCanonicalMapping
   return String(String.UnicodeScalarView(folded.unicodeScalars.filter {
     switch $0.properties.generalCategory {
     case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter: return true
     default: return false
     }
   }))
 }
 static func main() throws {
   let stem = "a\u{105C0}b"
   let name = stem + " extra"
   let fixture: [String:Any] = ["version":"fixture", "categories":[["id":"fixture", "name":"Fixture", "emoji":[
     ["e":"😀", "n":name, "k":[], "v":1],
     ["e":"🐙", "n":"unrelated", "k":[], "v":1, "s":name]
   ]]]]
   let catalog = try JSONDecoder().decode(EmojiCatalog.self, from:JSONSerialization.data(withJSONObject:fixture))
   let search = EmojiSuggester(catalog:catalog)
   let spanishWords = canonical(name)
   var verified = 0
   let ignored = Set(["a","an","and","for","in","of","on","the","to","with"])
   var rows: [[String:Any]] = []
   for query in [name, "extra " + stem, name + " " + name] {
     let tokens = canonical(query)
     let projections = Set(tokens.map(project)).subtracting(ignored)
     let envelope = catalog.categories.flatMap(\.emoji).filter { entry in
       let terms = ([entry.name] + (entry.keywords ?? [])).flatMap { text -> [String] in
         let normalized = legacy(text)
         let words = normalized.split(separator:" ").map(String.init)
         return words + [words.joined(), normalized]
       }.map(project)
       return tokens.map(project).contains("") || projections.isEmpty || projections.allSatisfy { token in terms.contains { $0.contains(token) } }
     }.map(\.value)
     let localizedEligible = tokens.allSatisfy { token in spanishWords.contains { $0.hasPrefix(token) } }
     precondition(localizedEligible && envelope.isEmpty)
     precondition(Set(tokens) == Set(spanishWords))
     for cap in [1,48,60] {
       let legacyValues = search.search(query,limit:cap).map(\.value)
       precondition(legacyValues == (query == name ? ["😀"] : []))
       verified += 1
       rows.append(["query":query, "canonical":tokens, "queryProjections":projections.sorted(),
         "legacyNormalized":legacy(query), "englishNameProjection":project(legacy(name)), "envelope":envelope,
         "limit":cap, "legacyValues":legacyValues, "localizedEligible":localizedEligible,
         "requiredAppendValues":legacyValues + ["🐙"], "requiredAppendExceedsCap":legacyValues.count + 1 > cap])
     }
   }
   let scalar = Unicode.Scalar(0x105C0)!
   let output: [String:Any] = ["fixture":fixture, "scalar":"U+105C0", "swiftCategory":String(describing:scalar.properties.generalCategory),
     "foundationAlphanumeric":CharacterSet.alphanumerics.contains(scalar), "foundationLetter":CharacterSet.letters.contains(scalar),
     "rawProjection":project(name), "verifiedRows":verified, "rows":rows]
   let data = try JSONSerialization.data(withJSONObject:output,options:[.prettyPrinted,.sortedKeys])
   try data.write(to:URL(fileURLWithPath:CommandLine.arguments[1]))
   print(String(decoding:data,as:UTF8.self))
 }
}
