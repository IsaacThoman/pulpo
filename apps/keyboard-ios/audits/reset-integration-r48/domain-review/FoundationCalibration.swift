import Foundation

// Independent implementation of the proposed PUBLIC normalization/alignment
// semantics. No KeyboardCore import, model invocation, qwerty update formula,
// persistence, dictionary, prior benchmark or process/device interaction.
struct Norm: Decodable { let id: String; let input: String; let expected: String }
struct Align: Decodable {
  let id: String; let text: String; let target: String
  let expectedCharacters: [String]; let expectedKeyed: String
  let expectedOrigins: [Int]; let pointStates: [String]
  let expectedSamples: Int; let expectedLocal: Bool; let expectedPersistent: Bool
}
struct Input: Decodable { let normalization: [Norm]; let alignment: [Align] }
func publicKeyReference(_ input: String) -> String {
  let scalars: [Unicode.Scalar]
  if input.unicodeScalars.allSatisfy({ $0.value < 128 }) {
    scalars = input.unicodeScalars.compactMap { scalar in
      if scalar.value == 39 { return nil }
      let value = scalar.value
      return Unicode.Scalar((65...90).contains(value) ? value + 32 : value)
    }
  } else {
    let decomposed = input.lowercased().decomposedStringWithCompatibilityMapping
    scalars = decomposed.unicodeScalars.filter {
      $0.value != 39 && $0.value != 0x2019 && $0.properties.generalCategory != .nonspacingMark
    }
  }
  return String(String.UnicodeScalarView(scalars))
}
func scalars(_ value: String) -> [UInt32] { value.unicodeScalars.map(\.value) }
let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let input = try JSONDecoder().decode(Input.self, from: data)
var results: [[String: Any]] = []
for row in input.normalization {
  let actual = publicKeyReference(row.input)
  results.append(["id": row.id, "kind": "normalization", "pass": scalars(actual) == scalars(row.expected),
                  "actualScalars": scalars(actual), "expectedScalars": scalars(row.expected),
                  "actualUTF8": Array(actual.utf8)])
}
for row in input.alignment {
  let chars = row.text.map(String.init)
  var bytes: [UInt8] = []; var origins: [Int] = []
  for (i, char) in chars.enumerated() {
    let part = Array(publicKeyReference(char).utf8)
    bytes += part; origins += Array(repeating: i, count: part.count)
  }
  let target = Array(publicKeyReference(row.target).utf8)
  var contributing: [Int] = []; var invalidFinite = false
  let aligned = target.count >= 2 && target.count == bytes.count
  if aligned {
    for (i, byte) in target.enumerated() where (97...122).contains(byte) {
      let origin = origins[i]
      let state = origin < row.pointStates.count ? row.pointStates[origin] : "nil"
      if state == "nil" { continue }
      if state == "nonfinite" { invalidFinite = true; break }
      guard state == "finite" else { fatalError("Unknown literal point state") }
      contributing.append(origin)
    }
  }
  if invalidFinite { contributing = [] }
  let local = aligned && !invalidFinite && !contributing.isEmpty
  let persistent = local && contributing.count <= 40
  let charactersMatch = chars.map(scalars) == row.expectedCharacters.map(scalars)
  let pass = charactersMatch && bytes == Array(row.expectedKeyed.utf8) && origins == row.expectedOrigins &&
             contributing.count == row.expectedSamples && local == row.expectedLocal && persistent == row.expectedPersistent
  results.append(["id": row.id, "kind": "alignment", "pass": pass,
                  "characters": chars.map(scalars), "characterExpectationMatched": charactersMatch,
                  "keyedUTF8": bytes, "targetUTF8": target, "origins": origins,
                  "samples": contributing.count, "local": local, "persistent": persistent])
}
let failures = results.filter { ($0["pass"] as? Bool) != true }
let output: [String: Any] = ["classification": "exposed Foundation-only reference calibration; no product execution",
                           "runtime": ProcessInfo.processInfo.operatingSystemVersionString,
                           "count": results.count, "passed": results.count - failures.count,
                           "failed": failures.count, "results": results]
let encoded = try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
try encoded.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
print("Foundation-only literal calibration: \(results.count - failures.count)/\(results.count); failed IDs: \(failures.compactMap { $0["id"] as? String })")
