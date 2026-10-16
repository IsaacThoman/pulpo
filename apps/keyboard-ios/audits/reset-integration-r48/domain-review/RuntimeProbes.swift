import Foundation
func codes(_ s: String) -> [UInt32] { s.unicodeScalars.map(\.value) }
let inputs = ["ΟΣ", "AΣ", "Σ", "Straße", "ẞ", "\u{1D2C}", "a\u{0897}", "a\u{0903}", "a\u{20DD}"]
let rows: [[String: Any]] = inputs.map { text in
  ["input": codes(text), "swiftLower": codes(text.lowercased()),
   "nsStringLower": codes((text as NSString).lowercased),
   "perCharacterSwiftLower": text.map { codes(String($0).lowercased()) },
   "swiftCategories": text.unicodeScalars.map { String(describing: $0.properties.generalCategory) },
   "foundationCompatibility": codes(text.decomposedStringWithCompatibilityMapping)]
}
let data = try JSONSerialization.data(withJSONObject: ["classification":"Exposed runtime diagnostics, not pass/fail or product execution", "runtime":ProcessInfo.processInfo.operatingSystemVersionString,"rows":rows], options: [.prettyPrinted,.sortedKeys])
try data.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
print("Independent Foundation runtime probes recorded: \(rows.count)")
