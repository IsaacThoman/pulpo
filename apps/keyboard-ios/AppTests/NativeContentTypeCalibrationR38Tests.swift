import UIKit
import XCTest
import KeyboardUI
@testable import PulpoKeyboard

@MainActor
final class NativeContentTypeCalibrationR38Tests: XCTestCase {
  func testCalibrateSDKNamedConstantsThroughAdapter() throws {
    let fields: [(String, UITextContentType, Bool)] = [
      ("username", .username, true),
      ("password", .password, true),
      ("newPassword", .newPassword, true),
      ("oneTimeCode", .oneTimeCode, true),
      ("emailAddress", .emailAddress, true),
      ("URL", .URL, true),
      ("telephoneNumber", .telephoneNumber, true),
      ("creditCardNumber", .creditCardNumber, true),
      ("creditCardSecurityCode", .creditCardSecurityCode, true),
      ("creditCardExpiration", .creditCardExpiration, true),
      ("creditCardExpirationMonth", .creditCardExpirationMonth, true),
      ("creditCardExpirationYear", .creditCardExpirationYear, true),
      ("creditCardName", .creditCardName, true),
      ("creditCardGivenName", .creditCardGivenName, true),
      ("creditCardFamilyName", .creditCardFamilyName, true),
      ("creditCardMiddleName", .creditCardMiddleName, true),
      ("creditCardType", .creditCardType, true),
      ("postalCode", .postalCode, true),
      ("flightNumber", .flightNumber, true),
      ("shipmentTrackingNumber", .shipmentTrackingNumber, true),
      ("birthdate", .birthdate, true),
      ("birthdateDay", .birthdateDay, true),
      ("birthdateMonth", .birthdateMonth, true),
      ("birthdateYear", .birthdateYear, true),
      ("name", .name, false),
      ("namePrefix", .namePrefix, false),
      ("givenName", .givenName, false),
      ("middleName", .middleName, false),
      ("familyName", .familyName, false),
      ("nameSuffix", .nameSuffix, false),
      ("nickname", .nickname, false),
      ("jobTitle", .jobTitle, false),
      ("organizationName", .organizationName, false),
      ("location", .location, false),
      ("fullStreetAddress", .fullStreetAddress, false),
      ("streetAddressLine1", .streetAddressLine1, false),
      ("streetAddressLine2", .streetAddressLine2, false),
      ("addressCity", .addressCity, false),
      ("addressState", .addressState, false),
      ("addressCityAndState", .addressCityAndState, false),
      ("sublocality", .sublocality, false),
      ("countryName", .countryName, false),
      ("dateTime", .dateTime, false),
      ("cellularEID", .cellularEID, false),
      ("cellularIMEI", .cellularIMEI, false),
    ]
    let editor = UITextView()
    let host = PreviewHost(textView: editor) { _ in XCTFail("Unexpected navigation") }
    var rows: [[String: Any]] = []
    for (id, native, declaredPrivate) in fields {
      editor.textContentType = native
      editor.keyboardType = .default
      let traits = host.inputTraits
      XCTAssertEqual(traits.contentType, native.rawValue)
      rows.append(["id": id, "rawValue": native.rawValue, "adapterRawValue": traits.contentType!, "declaredPrivate": declaredPrivate, "observedPrivate": traits.isPrivate])
    }
    let result: [String: Any] = ["os": UIDevice.current.systemVersion, "fields": rows]
    let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys, .prettyPrinted])
    let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("r38-calibration.json")
    try data.write(to: url)
    let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
    attachment.name = "r38-native-calibration"
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
