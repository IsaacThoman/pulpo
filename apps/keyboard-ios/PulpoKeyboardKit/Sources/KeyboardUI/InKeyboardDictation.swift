#if os(iOS)
import AVFoundation
import KeyboardCore
import UIKit
import WebKit

/// Uploads a recording the keyboard made itself and returns the transcript.
public protocol KeyboardDictationTranscriber: AnyObject {
  /// Whether a signed-in session is readable here. Without one the app records instead.
  var canTranscribe: Bool { get }
  func transcribe(audio: Data, filename: String, mimeType: String) async throws -> String
}

/// A transcription failure to show as written.
public struct KeyboardDictationError: LocalizedError, Sendable {
  public let message: String
  /// The account's session no longer works; signing in again in the app fixes it.
  public let needsSignIn: Bool

  public init(message: String, needsSignIn: Bool = false) {
    self.message = message
    self.needsSignIn = needsSignIn
  }

  public var errorDescription: String? { message }
}

/// Records dictation inside the keyboard, so the mic key never leaves the app being typed in.
///
/// iOS won't let a keyboard extension record through `AVAudioSession`. A `WKWebView`
/// can: `getUserMedia` captures in WebKit's media process under the app's microphone
/// permission (the approach Hex's iPhone keyboard uses, github.com/anomalyco/hex). The
/// page streams 16-bit PCM back, which is encoded to AAC and uploaded to Pulpo like the
/// app's own recordings. When capture can't start, the keyboard opens the app as before.
///
/// One per process: iOS builds a new keyboard controller for each presentation, and the
/// one on screen picks up a dictation an earlier one started.
@MainActor
final class InKeyboardDictation {
  static let shared = InKeyboardDictation()
  static let didChange = Notification.Name("com.isaacthoman.pulpo.keyboard.inKeyboardDictation")
  static let maximumSeconds: TimeInterval = 90
  /// The first capture launches WebKit's processes, which takes about a second.
  static let startTimeout: TimeInterval = 5

  /// iOS 26 is where in-keyboard WebKit capture is known to work; earlier versions use the app.
  static var isSupported: Bool {
    guard !webCaptureRefused else { return false }
    if #available(iOS 26.0, *) { return true }
    return false
  }

  /// WebKit refused the microphone in this process; stop trying until the keyboard relaunches.
  private static var webCaptureRefused = false

  private(set) var requestID: UUID?
  /// Nil while starting, then the same states the app publishes.
  private(set) var state: DictationState?
  private(set) var levels: [Float] = []
  /// Set when capture couldn't start, so the keyboard falls back to the app.
  private(set) var startFailure: String?
  /// The last failure needs a fresh sign-in.
  private(set) var needsSignIn = false

  private var capture: WebAudioCapture?
  private var recording: AACRecording?
  private var transcriber: KeyboardDictationTranscriber?
  private var upload: Task<Void, Never>?
  private var startTimer: Timer?
  private var limitTimer: Timer?

  private var requestedAt = Date()

  var isActive: Bool {
    guard requestID != nil, startFailure == nil else { return false }
    return state == nil || state?.phase == .recording || state?.phase == .transcribing
  }

  func start(request: UUID, in container: UIView, transcriber: KeyboardDictationTranscriber) {
    cancel()
    requestID = request
    requestedAt = Date()
    self.transcriber = transcriber
    let capture = capture ?? WebAudioCapture()
    self.capture = capture
    capture.attach(to: container)
    capture.onEvent = { [weak self] event in self?.handle(event, request: request) }
    Self.preferBuiltInMicrophone()
    capture.start()
    let timer = Timer(timeInterval: Self.startTimeout, repeats: false) { [weak self] _ in
      MainActor.assumeIsolated { self?.failToStart("timed out", request: request) }
    }
    RunLoop.main.add(timer, forMode: .common)
    startTimer = timer
  }

  func stop() {
    guard let request = requestID, state?.phase == .recording else { return }
    finishRecording(request: request)
  }

  func cancel() {
    upload?.cancel()
    upload = nil
    invalidateTimers()
    capture?.onEvent = nil
    capture?.stop()
    recording?.discard()
    recording = nil
    requestID = nil
    state = nil
    levels = []
    startFailure = nil
    needsSignIn = false
    Self.releaseAudioSession()
  }

  /// Frees WebKit's processes when nothing is recording.
  func releaseIfIdle() {
    guard !isActive else { return }
    capture?.tearDown()
    capture = nil
  }

  // MARK: Capture

  private func handle(_ event: WebAudioCapture.Event, request: UUID) {
    guard requestID == request else { return }
    switch event {
    case .started(let sampleRate):
      guard state == nil else { return }
      do {
        recording = try AACRecording(sampleRate: sampleRate)
      } catch {
        capture?.stop()
        return failToStart("file: \(error.localizedDescription)", request: request)
      }
      startTimer?.invalidate()
      startTimer = nil
      Diagnostics.record("keyboard", "inKeyboardDictation", ["outcome": "started", "ms": Int(Date().timeIntervalSince(requestedAt) * 1000), "rate": Int(sampleRate)])
      levels = []
      update(DictationState(phase: .recording, requestID: request, startedAt: Date()))
      let limit = Timer(timeInterval: Self.maximumSeconds, repeats: false) { [weak self] _ in
        MainActor.assumeIsolated { self?.stop() }
      }
      RunLoop.main.add(limit, forMode: .common)
      limitTimer = limit
    case .samples(let data):
      guard state?.phase == .recording, let level = recording?.append(data) else { return }
      levels.append(level)
      if levels.count > DictationBridge.levelCount { levels.removeFirst(levels.count - DictationBridge.levelCount) }
    case .failed(let message):
      if state == nil {
        if message.hasPrefix("NotAllowedError") { Self.webCaptureRefused = true }
        failToStart(message, request: request)
      } else if state?.phase == .recording {
        fail("The microphone stopped. Try again.")
      }
    case .processTerminated:
      capture = nil
      if state == nil { failToStart("WebKit ended", request: request) } else if state?.phase == .recording { fail("The microphone stopped. Try again.") }
    }
  }

  private func finishRecording(request: UUID) {
    invalidateTimers()
    capture?.onEvent = nil
    capture?.stop()
    Self.releaseAudioSession()
    guard let recording, let transcriber else { return fail("The recording couldn't be saved.") }
    self.recording = nil
    let (url, seconds) = recording.close()
    update(DictationState(phase: .transcribing, requestID: request, startedAt: state?.startedAt))
    let audio = (try? Data(contentsOf: url)) ?? Data()
    try? FileManager.default.removeItem(at: url)
    guard seconds >= 0.3, audio.count > 500 else { return fail("No speech was detected.") }
    upload = Task { [weak self] in
      do {
        let text = try await transcriber.transcribe(audio: audio, filename: "dictation.m4a", mimeType: "audio/mp4")
        guard let self, !Task.isCancelled, self.requestID == request else { return }
        self.upload = nil
        self.update(DictationState(phase: .finished, requestID: request, transcript: text))
      } catch {
        guard let self, !Task.isCancelled, self.requestID == request else { return }
        self.upload = nil
        let known = error as? KeyboardDictationError
        self.fail(known?.message ?? "The recording couldn't be transcribed.", needsSignIn: known?.needsSignIn == true)
      }
    }
  }

  private func failToStart(_ reason: String, request: UUID) {
    guard requestID == request, state == nil else { return }
    Diagnostics.record("keyboard", "inKeyboardDictation", ["outcome": "fallback", "reason": String(reason.prefix(80))])
    invalidateTimers()
    capture?.onEvent = nil
    capture?.stop()
    recording?.discard()
    recording = nil
    Self.releaseAudioSession()
    startFailure = reason
    NotificationCenter.default.post(name: Self.didChange, object: self)
  }

  /// The keyboard took over the request after a failed start.
  func clearStartFailure() {
    requestID = nil
    startFailure = nil
  }

  private func fail(_ message: String, needsSignIn: Bool = false) {
    guard let request = requestID else { return }
    invalidateTimers()
    capture?.onEvent = nil
    capture?.stop()
    recording?.discard()
    recording = nil
    Self.releaseAudioSession()
    self.needsSignIn = needsSignIn
    update(DictationState(phase: .failed, requestID: request, errorMessage: message))
  }

  private func update(_ state: DictationState) {
    self.state = state
    NotificationCenter.default.post(name: Self.didChange, object: self)
  }

  private func invalidateTimers() {
    startTimer?.invalidate()
    startTimer = nil
    limitTimer?.invalidate()
    limitTimer = nil
  }

  // MARK: Audio session

  /// Records from the iPhone's microphone and mixes with other audio, so music or a car's
  /// Bluetooth doesn't drop into call audio, which pauses playback and stalls the start.
  private static func preferBuiltInMicrophone() {
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .allowBluetoothA2DP, .defaultToSpeaker])
      if let builtIn = session.availableInputs?.first(where: { $0.portType == .builtInMic }) {
        try session.setPreferredInput(builtIn)
      }
    } catch {
      Diagnostics.record("keyboard", "inKeyboardDictation", ["outcome": "sessionCategory", "error": (error as NSError).code])
    }
  }

  /// Lets music that the capture paused resume.
  private static func releaseAudioSession() {
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}

/// Encodes the page's 16-bit mono PCM to AAC, the format the app uploads.
private final class AACRecording {
  private let url = FileManager.default.temporaryDirectory.appendingPathComponent("dictation-\(UUID().uuidString).m4a")
  private var file: AVAudioFile?
  private let format: AVAudioFormat
  private var frames = 0

  init(sampleRate: Double) throws {
    guard sampleRate > 0, let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false) else {
      throw CocoaError(.featureUnsupported)
    }
    self.format = format
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: 1,
      AVEncoderBitRateKey: 48_000,
    ]
    file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
  }

  /// Writes the samples and returns their level on the Pulpo app's meter curve.
  func append(_ data: Data) -> Float {
    let count = data.count / 2
    guard count > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)),
          let target = buffer.floatChannelData?[0] else { return 0 }
    buffer.frameLength = AVAudioFrameCount(count)
    var sum: Float = 0
    data.withUnsafeBytes { raw in
      let samples = raw.bindMemory(to: Int16.self)
      for index in 0..<count {
        let value = Float(Int16(littleEndian: samples[index])) / 32_768
        target[index] = value
        sum += value * value
      }
    }
    try? file?.write(from: buffer)
    frames += count
    return DictationLevels.normalized(rms: (sum / Float(count)).squareRoot())
  }

  /// Closes the file and returns it with its length in seconds.
  func close() -> (URL, TimeInterval) {
    file = nil
    return (url, Double(frames) / format.sampleRate)
  }

  func discard() {
    file = nil
    try? FileManager.default.removeItem(at: url)
  }
}

/// A hidden page that records the microphone with `getUserMedia` and posts PCM chunks.
private final class WebAudioCapture: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
  enum Event {
    case started(sampleRate: Double)
    case samples(Data)
    case failed(String)
    case processTerminated
  }

  var onEvent: ((Event) -> Void)?
  private let webView: WKWebView
  private var isLoaded = false
  private var startWhenLoaded = false

  override init() {
    let configuration = WKWebViewConfiguration()
    configuration.allowsInlineMediaPlayback = true
    configuration.mediaTypesRequiringUserActionForPlayback = []
    configuration.websiteDataStore = .nonPersistent()
    webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 2, height: 2), configuration: configuration)
    super.init()
    configuration.userContentController.add(WeakScriptMessageHandler(self), name: "pulpo")
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.isUserInteractionEnabled = false
    webView.isOpaque = false
    webView.accessibilityElementsHidden = true
    // WebKit pauses pages it considers invisible, so the view stays on screen, just barely.
    webView.alpha = 0.02
    // getUserMedia needs a secure origin; nothing is fetched from it.
    webView.loadHTMLString(Self.page, baseURL: URL(string: "https://keyboard.pulpo.invalid/"))
  }

  /// The view must be in the keyboard's window while it captures.
  func attach(to container: UIView) {
    guard webView.superview !== container else { return }
    container.addSubview(webView)
  }

  func start() {
    guard isLoaded else {
      startWhenLoaded = true
      return
    }
    webView.evaluateJavaScript("pulpoStart()")
  }

  func stop() {
    startWhenLoaded = false
    guard isLoaded else { return }
    webView.evaluateJavaScript("pulpoStop()")
  }

  func tearDown() {
    onEvent = nil
    stop()
    webView.configuration.userContentController.removeScriptMessageHandler(forName: "pulpo")
    webView.removeFromSuperview()
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    isLoaded = true
    if startWhenLoaded {
      startWhenLoaded = false
      start()
    }
  }

  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
               type: WKMediaCaptureType, decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void) {
    decisionHandler(type == .microphone ? .grant : .deny)
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    isLoaded = false
    onEvent?(.processTerminated)
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
    switch type {
    case "started":
      onEvent?(.started(sampleRate: (body["rate"] as? Double) ?? 48_000))
    case "pcm":
      guard let encoded = body["data"] as? String, let data = Data(base64Encoded: encoded) else { return }
      onEvent?(.samples(data))
    case "error":
      onEvent?(.failed((body["message"] as? String) ?? "unknown"))
    default:
      break
    }
  }

  /// Echo cancellation and noise suppression stay off: the server's model wants the raw voice.
  private static let page = """
  <!doctype html><meta charset="utf-8"><script>
  // Each start gets a generation; a start that a stop or newer start superseded while it
  // awaited the microphone releases what it opened instead of publishing it.
  let context = null, stream = null, source = null, processor = null, generation = 0;
  const post = (message) => webkit.messageHandlers.pulpo.postMessage(message);
  const constraints = { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  const release = (media) => { if (media) media.getTracks().forEach((track) => track.stop()); };
  async function builtInMicrophone() {
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
    const found = inputs.find((device) => /iphone|built-in/i.test(device.label));
    return found ? found.deviceId : null;
  }
  async function pulpoStart() {
    pulpoStop();
    const mine = generation;
    let media = null, audio = null;
    const current = () => mine === generation;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: constraints });
      if (!current()) return release(media);
      // Device labels are only readable once access is granted.
      const builtIn = await builtInMicrophone();
      if (!current()) return release(media);
      if (builtIn && media.getAudioTracks()[0].getSettings().deviceId !== builtIn) {
        release(media);
        media = await navigator.mediaDevices.getUserMedia({ audio: { ...constraints, deviceId: { exact: builtIn } } });
        if (!current()) return release(media);
      }
      audio = new AudioContext();
      await audio.resume();
      if (!current()) { release(media); return audio.close(); }
      stream = media;
      context = audio;
      source = audio.createMediaStreamSource(media);
      processor = audio.createScriptProcessor(2048, 1, 1);
      processor.onaudioprocess = (event) => {
        if (!current()) return;
        const input = event.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const sample = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }
        const bytes = new Uint8Array(pcm.buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        post({ type: "pcm", data: btoa(binary) });
      };
      source.connect(processor);
      processor.connect(audio.destination);
      post({ type: "started", rate: audio.sampleRate });
    } catch (error) {
      if (!current()) { release(media); if (audio) audio.close().catch(() => {}); return; }
      pulpoStop();
      release(media);
      if (audio) audio.close().catch(() => {});
      post({ type: "error", message: (error && error.name ? error.name + ": " + error.message : String(error)) });
    }
  }
  function pulpoStop() {
    generation++;
    try { if (processor) processor.disconnect(); if (source) source.disconnect(); } catch (e) {}
    release(stream);
    if (context) context.close().catch(() => {});
    context = stream = source = processor = null;
  }
  </script>
  """
}

/// The content controller keeps its handlers alive; this keeps it from keeping the capture.
private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
  weak var target: WKScriptMessageHandler?

  init(_ target: WKScriptMessageHandler) { self.target = target }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    target?.userContentController(controller, didReceive: message)
  }
}
#endif
