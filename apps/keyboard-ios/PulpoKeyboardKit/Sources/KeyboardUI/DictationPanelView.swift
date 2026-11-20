#if os(iOS)
import KeyboardCore
import UIKit

enum DictationPanelState: Equatable {
  /// Waiting for the app to start recording (opening it, or waking it from standby).
  case connecting
  case recording(startedAt: Date)
  case transcribing
  /// A requirement or error, with an optional action button.
  case message(title: String, detail: String?, action: String?)
}

/// Takes over the keyboard while dictating: the Pulpo app's scrolling waveform and timer,
/// stop and cancel.
final class DictationPanelView: UIView {
  var onStop: (() -> Void)?
  var onCancel: (() -> Void)?
  var onAction: (() -> Void)?

  private var style: KeyboardStyle
  private let title = UILabel()
  private let detail = UILabel()
  private let waveform = DictationWaveformView()
  private let elapsed = UILabel()
  private let stop = UIButton(type: .system)
  private let cancel = UIButton(type: .system)
  private let action = UIButton(type: .system)
  private let spinner = UIActivityIndicatorView(style: .medium)
  private var clock: Timer?
  private(set) var state: DictationPanelState = .connecting

  init(style: KeyboardStyle) {
    self.style = style
    super.init(frame: .zero)
    accessibilityIdentifier = "dictation-panel"
    title.font = .systemFont(ofSize: 17, weight: .semibold)
    title.textAlignment = .center
    title.accessibilityIdentifier = "dictation-title"
    detail.font = .systemFont(ofSize: 14)
    detail.textAlignment = .center
    detail.numberOfLines = 3
    elapsed.font = .monospacedDigitSystemFont(ofSize: 13, weight: .regular)
    elapsed.textAlignment = .left
    [title, detail, waveform, elapsed, spinner].forEach(addSubview)

    var stopConfiguration = UIButton.Configuration.filled()
    stopConfiguration.cornerStyle = .capsule
    stopConfiguration.image = UIImage(systemName: "checkmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .semibold))
    stop.configuration = stopConfiguration
    stop.accessibilityLabel = "Done"
    stop.accessibilityIdentifier = "dictation-done"
    stop.addTarget(self, action: #selector(stopTapped), for: .touchUpInside)
    addSubview(stop)

    var cancelConfiguration = UIButton.Configuration.gray()
    cancelConfiguration.cornerStyle = .capsule
    cancelConfiguration.image = UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .semibold))
    cancel.configuration = cancelConfiguration
    cancel.accessibilityLabel = "Cancel dictation"
    cancel.accessibilityIdentifier = "dictation-cancel"
    cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
    addSubview(cancel)

    var actionConfiguration = UIButton.Configuration.filled()
    actionConfiguration.cornerStyle = .capsule
    action.configuration = actionConfiguration
    action.accessibilityIdentifier = "dictation-action"
    action.addTarget(self, action: #selector(actionTapped), for: .touchUpInside)
    addSubview(action)
    applyStyle(style)
    set(.connecting)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  /// Leaving dictation only hides the panel; the waveform's display link must not keep
  /// running behind the keys.
  override var isHidden: Bool {
    didSet {
      guard isHidden != oldValue else { return }
      if isHidden {
        waveform.stop()
      } else if case .recording = state {
        waveform.start()
      }
    }
  }

  func applyStyle(_ style: KeyboardStyle) {
    self.style = style
    title.textColor = style.label
    detail.textColor = style.secondaryLabel
    elapsed.textColor = style.secondaryLabel
    waveform.color = style.label
    // The Pulpo app's prominent composer button: near-black on light, near-white on dark.
    let prominent = style.dark ? UIColor(red: 0.95, green: 0.95, blue: 0.97, alpha: 1) : UIColor(red: 0.11, green: 0.11, blue: 0.12, alpha: 1)
    let onProminent = style.dark ? UIColor(red: 0.11, green: 0.11, blue: 0.12, alpha: 1) : .white
    for button in [stop, action] {
      button.configuration?.baseBackgroundColor = prominent
      button.configuration?.baseForegroundColor = onProminent
    }
    cancel.tintColor = style.label
    spinner.color = style.secondaryLabel
  }

  func set(_ state: DictationPanelState) {
    self.state = state
    clock?.invalidate()
    clock = nil
    action.isHidden = true
    stop.isHidden = true
    waveform.isHidden = true
    // Repeated recording updates keep the waveform's history running.
    if case .recording = state {} else { waveform.stop() }
    elapsed.isHidden = true
    spinner.stopAnimating()
    detail.text = nil
    switch state {
    case .connecting:
      title.text = "Starting dictation…"
      detail.text = "Pulpo Keyboard is getting the microphone ready."
      spinner.startAnimating()
    case .recording(let startedAt):
      title.text = "Listening"
      waveform.isHidden = false
      waveform.start()
      elapsed.isHidden = false
      stop.isHidden = false
      updateElapsed(since: startedAt)
      let timer = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in
        MainActor.assumeIsolated { self?.updateElapsed(since: startedAt) }
      }
      RunLoop.main.add(timer, forMode: .common)
      clock = timer
    case .transcribing:
      title.text = "Transcribing…"
      spinner.startAnimating()
    case let .message(text, detailText, actionTitle):
      title.text = text
      detail.text = detailText
      if let actionTitle {
        action.configuration?.title = actionTitle
        action.isHidden = false
      }
    }
    setNeedsLayout()
  }

  private func updateElapsed(since start: Date) {
    let interval = max(0, Date().timeIntervalSince(start))
    let seconds = Int(interval)
    elapsed.text = String(format: "%d:%02d", seconds / 60, seconds % 60)
    elapsed.textColor = DictationLevels.nearsLimit(seconds: interval) ? warning : style.secondaryLabel
  }

  /// The Pulpo app's warning color for the last seconds before the limit.
  private var warning: UIColor {
    style.dark ? UIColor(red: 1, green: 0.69, blue: 0.35, alpha: 1) : UIColor(red: 0.64, green: 0.29, blue: 0, alpha: 1)
  }

  /// Recent levels, newest last; the waveform samples the newest at its own pace.
  func setLevels(_ levels: [Float]) {
    waveform.level = levels.last ?? 0
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let width = bounds.width
    title.frame = CGRect(x: 16, y: 18, width: width - 32, height: 22)
    detail.frame = CGRect(x: 24, y: title.frame.maxY + 4, width: width - 48, height: 54)
    // One row like the app's dictation strip: waveform, then the timer beside it.
    let timerWidth: CGFloat = 40
    let rowX: CGFloat = 32
    let rowY = bounds.height * 0.42
    waveform.frame = CGRect(x: rowX, y: rowY - DictationWaveformView.height / 2,
                            width: max(0, width - 2 * rowX - timerWidth - 8), height: DictationWaveformView.height)
    elapsed.frame = CGRect(x: waveform.frame.maxX + 8, y: rowY - 9, width: timerWidth, height: 18)
    spinner.center = CGPoint(x: width / 2, y: bounds.height * 0.55)
    let buttonSize: CGFloat = 54
    let buttonY = bounds.height - buttonSize - 14
    cancel.frame = CGRect(x: 24, y: buttonY, width: buttonSize, height: buttonSize)
    stop.frame = CGRect(x: width - 24 - buttonSize, y: buttonY, width: buttonSize, height: buttonSize)
    let actionWidth = min(260, width - 2 * (buttonSize + 40))
    action.frame = CGRect(x: (width - actionWidth) / 2, y: buttonY + 4, width: actionWidth, height: 46)
  }

  @objc private func stopTapped() { onStop?() }
  @objc private func cancelTapped() { onCancel?() }
  @objc private func actionTapped() { onAction?() }
}

/// The Pulpo app's dictation waveform (`DictationStrip.tsx`): thin bars that keep their
/// sample's height while the row glides left, the newest sliding in from the right.
final class DictationWaveformView: UIView {
  static let height: CGFloat = 28
  private static let minimumBarHeight: CGFloat = 2

  var color: UIColor = .label { didSet { setNeedsDisplay() } }
  /// The newest level, 0…1; sampled into the history every `DictationLevels.interval`.
  var level: Float = 0
  private var history = [Float](repeating: 0, count: DictationLevels.samples)
  private var link: CADisplayLink?
  private var lastSample: CFTimeInterval = 0
  private var now: CFTimeInterval = 0

  override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = false
    contentMode = .redraw
    clipsToBounds = true
    isAccessibilityElement = false
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  /// Starts from a flat line, as each recording does in the app.
  func start() {
    guard link == nil else { return }
    history = [Float](repeating: 0, count: DictationLevels.samples)
    level = 0
    lastSample = CACurrentMediaTime()
    now = lastSample
    let link = CADisplayLink(target: WeakTarget(self), selector: #selector(WeakTarget.tick(_:)))
    link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
    link.add(to: .main, forMode: .common)
    self.link = link
    setNeedsDisplay()
  }

  /// Freezes the waveform where it is.
  func stop() {
    link?.invalidate()
    link = nil
  }

  override func willMove(toWindow newWindow: UIWindow?) {
    super.willMove(toWindow: newWindow)
    if newWindow == nil { stop() }
  }

  fileprivate func tick(_ link: CADisplayLink) {
    now = link.targetTimestamp
    let elapsed = now - lastSample
    if elapsed >= DictationLevels.interval {
      // After a stall, take one sample and resume from now rather than catching up.
      lastSample = elapsed > 3 * DictationLevels.interval ? now : lastSample + DictationLevels.interval
      history.removeFirst()
      history.append(max(0, min(1, level)))
    }
    setNeedsDisplay()
  }

  override func draw(_ rect: CGRect) {
    let pitch = CGFloat(DictationLevels.barPitch)
    let barWidth = CGFloat(DictationLevels.barWidth)
    let count = DictationLevels.barCount(width: Double(bounds.width))
    // Each new sample moves every bar one slot left; sliding the row back from one pitch to
    // the right over an interval turns those steps into a continuous scroll.
    let progress = UIAccessibility.isReduceMotionEnabled ? 1 : min(1, max(0, (now - lastSample) / DictationLevels.interval))
    let offset = pitch * CGFloat(1 - progress)
    for index in 0..<count {
      let level = CGFloat(history[DictationLevels.samples - count + index])
      let height = Self.minimumBarHeight + level * (Self.height - Self.minimumBarHeight)
      let x = bounds.width - barWidth - CGFloat(count - 1 - index) * pitch + offset
      let bar = CGRect(x: x, y: (bounds.height - height) / 2, width: barWidth, height: height)
      color.withAlphaComponent(0.22 + level * 0.78).setFill()
      UIBezierPath(roundedRect: bar, cornerRadius: barWidth / 2).fill()
    }
  }

  /// A display link retains its target; this keeps it from retaining the view.
  private final class WeakTarget: NSObject {
    weak var view: DictationWaveformView?
    init(_ view: DictationWaveformView) { self.view = view }
    @objc func tick(_ link: CADisplayLink) {
      guard let view else { return link.invalidate() }
      view.tick(link)
    }
  }
}
#endif
