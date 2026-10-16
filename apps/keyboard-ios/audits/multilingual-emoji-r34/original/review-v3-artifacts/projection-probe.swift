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
   var failures: [[String:Any]] = []
   var tested = 0
   for code in 0...0x10ffff {
     guard let scalar = Unicode.Scalar(code) else { continue }
     for raw in [String(scalar), "a" + String(scalar) + "b", "c" + String(scalar) + "b"] {
       let terms = [legacy(raw)]
       let projected = terms.map(project)
       let tokens = canonical(raw).map(project)
       tested += 1
       if !tokens.contains("") && !tokens.allSatisfy({ t in projected.contains { $0.contains(t) } }) {
         failures.append(["scalar":String(format:"U+%04X",code), "query":raw, "canonical":canonical(raw), "projections":tokens, "englishProjection":projected])
         if failures.count >= 20 { break }
       }
     }
     if failures.count >= 20 { break }
   }
   let data = try JSONSerialization.data(withJSONObject:["tested":tested,"failures":failures],options:[.prettyPrinted,.sortedKeys])
   try data.write(to:URL(fileURLWithPath:CommandLine.arguments[1]))
   print(String(decoding:data,as:UTF8.self))
 }
}
