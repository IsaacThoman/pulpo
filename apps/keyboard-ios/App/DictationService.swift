import AVFoundation
import KeyboardCore
import Observation
import PulpoServices
import UIKit

/// Records dictation for the keyboard, which cannot use the microphone itself.
///
/// The keyboard opens the app (or, while the app is on standby, just sends a
/// command); the app records with the microphone, uploads the audio to Pulpo,
/// and hands the transcript back through the App Group. After a dictation the
/// audio engine keeps running for a few minutes so the next one starts without
/// leaving the current app, because iOS does not let a backgrounded app start
/// recording.
@Observable
final class DictationService {
  enum Phase: Equatable {
    case idle, recording, transcribing, finished, failed(String)
  }

  static let maximumSeconds: TimeInterval = 90

  private(set) var phase: Phase = .idle
  private(set) var levels: [Float] = []
  private(set) var startedAt: Date?
  private(set) var transcript: String?
  private(set) var standbyUntil: Date?
  /// Whether the most recent dictation was started from another app's keyboard.
  private(set) var startedFromKeyboard = false

  /// Sending the person back to the app they were typing in, once recording runs.
  enum ReturnState: Equatable {
    case none, finding, returned(String?), failed
  }
  private(set) var returnState: ReturnState = .none
  @ObservationIgnored var sessionProvider: (() -> StoredSession?)?
  @ObservationIgnored var onUnauthorized: (() -> Void)?
  @ObservationIgnored private let bridge = DictationBridge()
  @ObservationIgnored private let engine = AVAudioEngine()
  @ObservationIgnored private let capture = Capture()
  @ObservationIgnored private var request: UUID?
  @ObservationIgnored private var commandObserver: DarwinNotifications.Observation?
  @ObservationIgnored private var standbyTimer: Timer?
  @ObservationIgnored private var limitTimer: Timer?
  @ObservationIgnored private var levelTimer: Timer?
  @ObservationIgnored private var handledCommand: DictationCommand?
  @ObservationIgnored private var handoffStartedAt: Date?
  /// The host the keyboard named itself, when iOS still tells it (before iOS 26.4).
  @ObservationIgnored private var knownHost: String?

  init() {
    commandObserver = DarwinNotifications.observe(DictationBridge.commandNotification) { [weak self] in
      MainActor.assumeIsolated { self?.handleCommand() }
    }
    bridge?.writeState(.idle)
  }

  var isEngineRunning: Bool { engine.isRunning }

  // MARK: Commands from the keyboard

  private func handleCommand() {
    guard let command = bridge?.readCommand(), command != handledCommand,
          Date().timeIntervalSince(command.issuedAt) < 15 else { return }
    handledCommand = command
    switch command.kind {
    case .start:
      // From the background this only works while the engine is on standby; the
      // keyboard falls back to opening the app.
      if engine.isRunning || UIApplication.shared.applicationState != .background {
        start(request: command.requestID, fromURL: false)
      }
    case .stop:
      if command.requestID == request { stop() }
    case .cancel:
      if command.requestID == request { cancel() }
    }
  }

  // MARK: Recording

  func start(request: UUID, fromURL: Bool, host: String? = nil) {
    if phase == .recording, self.request == request { return }
    if phase == .recording { cancel() }
    startedFromKeyboard = fromURL
    self.request = request
    transcript = nil
    handoffStartedAt = fromURL ? Date() : nil
    knownHost = host.flatMap { HostReturn.isOwnApp($0) ? nil : $0 }
    returnState = fromURL ? .finding : .none
    guard sessionProvider?() != nil else {
      fail("Sign in to Pulpo to use dictation.")
      return
    }
    switch AVAudioApplication.shared.recordPermission {
    case .granted:
      beginRecording()
    case .undetermined:
      AVAudioApplication.requestRecordPermission { @Sendable granted in
        Task { @MainActor in
          granted ? self.beginRecording() : self.fail("Pulpo Keyboard needs microphone access to dictate. You can allow it in Settings.")
        }
      }
    default:
      fail("Pulpo Keyboard needs microphone access to dictate. You can allow it in Settings.")
    }
  }

  private func beginRecording() {
    guard let bridge else { return fail("The keyboard and app couldn't connect. Reinstall Pulpo Keyboard.") }
    do {
      try startEngineIfNeeded()
      try capture.begin(url: bridge.recordingURL, format: engine.inputNode.outputFormat(forBus: 0))
    } catch {
      return fail("The microphone couldn't start. \(error.localizedDescription)")
    }
    standbyTimer?.invalidate()
    startedAt = Date()
    levels = []
    phase = .recording
    publish()
    let limit = Timer(timeInterval: Self.maximumSeconds, repeats: false) { [weak self] _ in MainActor.assumeIsolated { self?.stop() } }
    RunLoop.main.add(limit, forMode: .common)
    limitTimer = limit
    let meter = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.pumpLevels() } }
    RunLoop.main.add(meter, forMode: .common)
    levelTimer = meter
    if let since = handoffStartedAt {
      handoffStartedAt = nil
      returnToHost(handoffAt: since)
    }
  }

  /// With recording running, reopens the app the keyboard came from. The host name
  /// arrives from UIKit about a second after launch; a host seen shortly before this
  /// handoff still counts, an older one doesn't.
  private func returnToHost(handoffAt: Date) {
    let recordingAfter = Date().timeIntervalSince(handoffAt)
    let named = knownHost
    knownHost = nil
    let resolve: (@escaping (String?) -> Void) -> Void = { done in
      if let named { return done(named) }
      HostAppObserver.shared.waitForHost(since: handoffAt.addingTimeInterval(-5), timeout: 3, completion: done)
    }
    resolve { [weak self] bundle in
      guard let self else { return }
      let waited = Date().timeIntervalSince(handoffAt)
      guard self.phase == .recording, let bundle else {
        self.returnState = .failed
        Diagnostics.record("app", "return", ["outcome": bundle == nil ? "no-host" : "not-recording", "observer": HostAppObserver.shared.isAvailable, "recordingMs": Int(recordingAfter * 1000), "waitedMs": Int(waited * 1000)])
        return
      }
      HostReturn.open(bundle) { method in
        self.returnState = method == .none ? .failed : .returned(HostReturn.name(for: bundle))
        Diagnostics.record("app", "return", ["outcome": method == .none ? "failed" : "returned", "method": method.rawValue, "host": bundle, "recordingMs": Int(recordingAfter * 1000), "hostMs": Int(waited * 1000)])
      }
    }
  }

  private func startEngineIfNeeded() throws {
    guard !engine.isRunning else { return }
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .defaultToSpeaker, .allowBluetoothHFP])
    try session.setActive(true)
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else { throw CocoaError(.featureUnsupported) }
    input.removeTap(onBus: 0)
    let capture = capture
    // Runs on the audio thread.
    input.installTap(onBus: 0, bufferSize: 2048, format: format) { @Sendable buffer, _ in
      capture.append(buffer)
    }
    engine.prepare()
    try engine.start()
  }

  private func pumpLevels() {
    levels = capture.levels
    bridge?.writeLevels(levels)
  }

  func stop() {
    guard phase == .recording, let request else { return }
    limitTimer?.invalidate()
    levelTimer?.invalidate()
    let url = capture.finish()
    phase = .transcribing
    publish()
    enterStandby()
    guard let url, let session = sessionProvider?() else { return fail("Sign in to Pulpo to use dictation.") }
    let audio = (try? Data(contentsOf: url)) ?? Data()
    try? FileManager.default.removeItem(at: url)
    guard audio.count > 500 else { return fail("No speech was detected.") }
    let client = PulpoClient(instance: session.instance, token: session.token)
    let task = UIApplication.shared.beginBackgroundTask(withName: "dictation-upload")
    Task {
      defer { UIApplication.shared.endBackgroundTask(task) }
      do {
        let text = try await client.transcribe(audio: audio)
        guard self.request == request else { return }
        self.transcript = text
        self.phase = .finished
        self.publish()
      } catch let error as PulpoError {
        guard self.request == request else { return }
        if error.isUnauthorized { self.onUnauthorized?() }
        self.fail(error.code == "dictation_no_speech" ? "No speech was detected." : error.message)
      } catch {
        guard self.request == request else { return }
        self.fail("The recording couldn't be transcribed.")
      }
    }
  }

  func cancel() {
    limitTimer?.invalidate()
    levelTimer?.invalidate()
    if let url = capture.finish() { try? FileManager.default.removeItem(at: url) }
    phase = .idle
    request = nil
    publish()
    enterStandby()
  }

  private func fail(_ message: String) {
    handoffStartedAt = nil
    if returnState == .finding { returnState = .failed }
    limitTimer?.invalidate()
    levelTimer?.invalidate()
    _ = capture.finish()
    phase = .failed(message)
    publish()
  }

  // MARK: Standby

  /// Keeps the microphone running (and discarding audio) so the keyboard can start
  /// the next dictation without switching apps.
  private func enterStandby() {
    let minutes = SettingsStore().load().dictationStandbyMinutes
    guard minutes > 0, engine.isRunning else { return endStandby() }
    standbyUntil = Date().addingTimeInterval(TimeInterval(minutes * 60))
    standbyTimer?.invalidate()
    let timer = Timer(timeInterval: TimeInterval(minutes * 60), repeats: false) { [weak self] _ in MainActor.assumeIsolated { self?.endStandby() } }
    RunLoop.main.add(timer, forMode: .common)
    standbyTimer = timer
    publish()
  }

  func endStandby() {
    standbyTimer?.invalidate()
    guard phase != .recording else { return }
    standbyUntil = nil
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    publish()
  }

  // MARK: Bridge

  private func publish() {
    let shared: DictationState.Phase
    var message: String?
    switch phase {
    case .idle: shared = .idle
    case .recording: shared = .recording
    case .transcribing: shared = .transcribing
    case .finished: shared = .finished
    case .failed(let text):
      shared = .failed
      message = text
    }
    bridge?.writeState(DictationState(
      phase: shared, requestID: request, standbyUntil: engine.isRunning ? standbyUntil : nil,
      startedAt: startedAt, transcript: transcript, errorMessage: message
    ))
  }
}

/// Writes microphone buffers to an AAC file and tracks recent levels. Called from the
/// audio thread, so state is behind a lock.
nonisolated final class Capture: @unchecked Sendable {
  private let lock = NSLock()
  private var file: AVAudioFile?
  private var url: URL?
  private var recent: [Float] = []

  func begin(url: URL, format: AVAudioFormat) throws {
    try? FileManager.default.removeItem(at: url)
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: format.sampleRate,
      AVNumberOfChannelsKey: 1,
      AVEncoderBitRateKey: 48_000,
    ]
    let created = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
    lock.withLock {
      file = created
      self.url = url
      recent = []
    }
  }

  func append(_ buffer: AVAudioPCMBuffer) {
    let level = Self.level(of: buffer)
    lock.withLock {
      recent.append(level)
      if recent.count > DictationBridge.levelCount { recent.removeFirst(recent.count - DictationBridge.levelCount) }
      guard let file else { return }
      let mono = buffer.format.channelCount == 1 ? buffer : Self.firstChannel(of: buffer)
      try? file.write(from: mono)
    }
  }

  var levels: [Float] { lock.withLock { recent } }

  /// Closes the file and returns its location.
  func finish() -> URL? {
    lock.withLock {
      let finished = file == nil ? nil : url
      file = nil
      url = nil
      return finished
    }
  }

  static func level(of buffer: AVAudioPCMBuffer) -> Float {
    guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
    var sum: Float = 0
    for index in 0..<Int(buffer.frameLength) { sum += samples[index] * samples[index] }
    let rms = (sum / Float(buffer.frameLength)).squareRoot()
    let decibels = 20 * log10(max(rms, 1e-6))
    // -55 dB is silence, -10 dB is loud speech.
    return min(1, max(0, (decibels + 55) / 45))
  }

  static func firstChannel(of buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer {
    guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: buffer.format.sampleRate, channels: 1, interleaved: false),
          let mono = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: buffer.frameLength),
          let source = buffer.floatChannelData?[0], let target = mono.floatChannelData?[0] else { return buffer }
    mono.frameLength = buffer.frameLength
    target.update(from: source, count: Int(buffer.frameLength))
    return mono
  }
}
