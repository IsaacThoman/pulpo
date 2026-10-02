import AVFoundation
import ExpoModulesCore
import Speech

private final class TranscriberUnavailableException: Exception, @unchecked Sendable {
  override var reason: String {
    "On-device transcription is not available on this device."
  }
}

private final class UnsupportedLocaleException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "On-device transcription does not support \(param)."
  }
}

private final class RecordingUnreadableException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "The recording could not be read at \(param)."
  }
}

public final class PulpoSpeechTranscriberModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PulpoSpeechTranscriber")

    Function("isAvailable") { () -> Bool in
      SpeechTranscriber.isAvailable
    }

    AsyncFunction("prepare") { (language: String) async throws -> String in
      guard SpeechTranscriber.isAvailable else {
        throw TranscriberUnavailableException()
      }
      guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: language)) else {
        throw UnsupportedLocaleException(language)
      }
      let transcriber = Self.makeTranscriber(locale: locale)
      switch await AssetInventory.status(forModules: [transcriber]) {
      case .installed:
        break
      case .supported, .downloading:
        // Downloads the language model the first time; later calls find it installed.
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
          try await request.downloadAndInstall()
        }
      case .unsupported:
        throw UnsupportedLocaleException(locale.identifier)
      @unknown default:
        throw UnsupportedLocaleException(locale.identifier)
      }
      return locale.identifier
    }

    AsyncFunction("transcribe") { (uri: URL, language: String) async throws -> String in
      guard uri.isFileURL, FileManager.default.fileExists(atPath: uri.path) else {
        throw RecordingUnreadableException(uri.absoluteString)
      }
      let audioFile: AVAudioFile
      do {
        audioFile = try AVAudioFile(forReading: uri)
      } catch {
        throw RecordingUnreadableException(uri.absoluteString)
      }

      let transcriber = Self.makeTranscriber(locale: Locale(identifier: language))
      let analyzer = SpeechAnalyzer(modules: [transcriber])
      // Collect results concurrently and await the collector, so no final segment
      // can arrive after the transcript has been returned.
      let collector = Task { () throws -> [String] in
        var segments: [String] = []
        for try await result in transcriber.results {
          if result.isFinal {
            segments.append(String(result.text.characters))
          }
        }
        return segments
      }

      do {
        if let lastSampleTime = try await analyzer.analyzeSequence(from: audioFile) {
          try await analyzer.finalizeAndFinish(through: lastSampleTime)
        } else {
          await analyzer.cancelAndFinishNow()
        }
        let segments = try await collector.value
        return segments
          .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
          .filter { !$0.isEmpty }
          .joined(separator: " ")
      } catch {
        collector.cancel()
        await analyzer.cancelAndFinishNow()
        _ = try? await collector.value
        throw error
      }
    }
  }

  private static func makeTranscriber(locale: Locale) -> SpeechTranscriber {
    let preset = SpeechTranscriber.Preset.timeIndexedTranscriptionWithAlternatives
    return SpeechTranscriber(
      locale: locale,
      transcriptionOptions: preset.transcriptionOptions,
      reportingOptions: preset.reportingOptions.subtracting([.alternativeTranscriptions]),
      attributeOptions: preset.attributeOptions
    )
  }
}
