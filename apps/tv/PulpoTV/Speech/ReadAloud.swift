import AVFoundation
import Observation
import PulpoKit

/// Reads replies aloud with the Apple TV's on-device voices, so listening
/// from the couch costs nothing and needs no speech model on the server.
@MainActor
@Observable
final class ReadAloud: NSObject {
    /// The message being read, if any.
    private(set) var speakingId: String?
    private(set) var isPaused = false

    @ObservationIgnored private let synthesizer = AVSpeechSynthesizer()

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func isSpeaking(_ id: String) -> Bool { speakingId == id }

    /// Starts reading `markdown`, or stops if this message is already playing.
    func toggle(id: String, markdown: String) {
        if speakingId == id {
            stop()
            return
        }
        let text = Markdown.plainText(markdown)
        guard !text.isEmpty else { return }
        stop()
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = Float(Double(AVSpeechUtteranceDefaultSpeechRate) * Preferences.speechRate)
        utterance.voice = AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode())
        utterance.prefersAssistiveTechnologySettings = true
        speakingId = id
        isPaused = false
        synthesizer.speak(utterance)
    }

    func pauseOrResume() {
        guard speakingId != nil else { return }
        if synthesizer.isPaused {
            synthesizer.continueSpeaking()
            isPaused = false
        } else {
            synthesizer.pauseSpeaking(at: .word)
            isPaused = true
        }
    }

    func stop() {
        guard speakingId != nil else { return }
        speakingId = nil
        isPaused = false
        synthesizer.stopSpeaking(at: .immediate)
    }

    fileprivate func finished() {
        // Ignore the stop of an utterance that was already replaced.
        guard synthesizer.isSpeaking == false else { return }
        speakingId = nil
        isPaused = false
    }
}

extension ReadAloud: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.finished() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.finished() }
    }
}
