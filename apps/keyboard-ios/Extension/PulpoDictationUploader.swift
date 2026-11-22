import Foundation
import KeyboardUI
import PulpoServices

/// Sends a recording the keyboard made to the signed-in account's Pulpo dictation.
/// The session is the app's, read from the Keychain group they share.
final class PulpoDictationUploader: KeyboardDictationTranscriber {
  private let store = SessionStore()

  var canTranscribe: Bool { store.load()?.dictationAvailable == true }

  func transcribe(audio: Data, filename: String, mimeType: String) async throws -> String {
    guard let session = store.load() else {
      throw KeyboardDictationError(message: "Open Pulpo Keyboard and sign in to dictate.", needsSignIn: true)
    }
    do {
      return try await PulpoClient(instance: session.instance, token: session.token)
        .transcribe(audio: audio, filename: filename, mimeType: mimeType)
    } catch let error as PulpoError {
      if error.isUnauthorized {
        throw KeyboardDictationError(message: "Your Pulpo sign-in expired. Sign in again in Pulpo Keyboard.", needsSignIn: true)
      }
      throw KeyboardDictationError(message: error.code == "dictation_no_speech" ? "No speech was detected." : error.message)
    }
  }
}
