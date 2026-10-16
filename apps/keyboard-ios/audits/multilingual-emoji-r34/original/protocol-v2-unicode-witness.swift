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
 static func main() throws {
   let data = Data(#"{"version":"fixture","categories":[{"id":"fixture","name":"Fixture","emoji":[{"e":"😀","n":"a\u093eb","k":[],"v":1},{"e":"🐙","n":"unrelated","k":[],"v":1,"s":"ab"}]}]}"#.utf8)
   let catalog = try JSONDecoder().decode(EmojiCatalog.self, from: data)
   let suggester = EmojiSuggester(catalog:catalog)
   var rows: [[String:Any]] = []
   for q in ["a\u{093E}b", "ab", "ab ab"] {
     let tokens = canonical(q)
     let folded = Set(tokens.flatMap { legacy($0).split(separator:" ").map(String.init) })
     let envelope = catalog.categories.flatMap(\.emoji).filter { e in
       let terms = ([e.name] + (e.keywords ?? [])).flatMap { text -> [String] in
         let words = legacy(text).split(separator:" ").map(String.init)
         return words + [words.joined()]
       }
       return folded.allSatisfy { t in terms.contains { $0.contains(t) } }
     }.map(\.value)
     rows.append(["query":q,"canonical":tokens,"legacyNormalized":legacy(q),"legacyValues":suggester.search(q,limit:1).map(\.value),"envelope":envelope])
   }
   let encoded = try JSONSerialization.data(withJSONObject:rows,options:[.prettyPrinted,.sortedKeys])
   try encoded.write(to:URL(fileURLWithPath:"/tmp/r34-protocol-v2/unicode-witness.json"))
   print(String(decoding:encoded,as:UTF8.self))
 }
}
