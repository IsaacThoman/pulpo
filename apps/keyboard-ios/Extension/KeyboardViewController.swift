import KeyboardUI
import PulpoServices

/// The extension's principal class; all behavior but the Pulpo upload lives in KeyboardUI.
final class KeyboardViewController: PulpoKeyboardViewController {
  private let uploader = PulpoDictationUploader()

  override var dictationTranscriber: KeyboardDictationTranscriber? { uploader }
}
