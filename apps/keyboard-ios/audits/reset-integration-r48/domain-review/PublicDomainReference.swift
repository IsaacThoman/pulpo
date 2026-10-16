import Foundation

// Independent implementation of the public R48 specification only.
// No product import/calls, learning formula, storage, cases or results.
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

struct PublicReferenceAlignment {
  let characters: [String]
  let typedBytes: [UInt8]
  let origins: [Int]
  let targetBytes: [UInt8]
  var lengthMatches: Bool { targetBytes.count >= 2 && typedBytes.count == targetBytes.count }

  // Pure structural contribution selection. Nil denotes an absent point;
  // true/false denotes finite/nonfinite displacement at an available point.
  // Unknown extra entries are never indexed beyond original Characters.
  func contributingOrigins(finitePoints: [Bool?]) -> [Int]? {
    guard lengthMatches else { return nil }
    var result: [Int] = []
    for (i, byte) in targetBytes.enumerated() where (97...122).contains(byte) {
      let origin = origins[i]
      let finite = origin < finitePoints.count ? finitePoints[origin] : nil
      guard let finite else { continue }
      guard finite else { return nil }
      result.append(origin)
    }
    return result.isEmpty ? nil : result
  }
}

func publicAlignmentReference(text: String, target: String) -> PublicReferenceAlignment {
  let characters = text.map(String.init)
  var bytes: [UInt8] = []
  var origins: [Int] = []
  for (i, character) in characters.enumerated() {
    let part = Array(publicKeyReference(character).utf8)
    bytes += part
    origins += Array(repeating: i, count: part.count)
  }
  return PublicReferenceAlignment(characters: characters, typedBytes: bytes,
                                  origins: origins, targetBytes: Array(publicKeyReference(target).utf8))
}
