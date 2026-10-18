#if os(iOS)
import UIKit

enum DictationPanelState: Equatable {
  /// Waiting for the app to start recording (opening it, or waking it from standby).
  case connecting
  case recording(startedAt: Date)
  case transcribing
  /// A requirement or error, with an optional action button.
  case message(title: String, detail: String?, action: String?)
}

/// Takes over the keyboard while dictating: live level meter, elapsed time, stop and cancel.
final class DictationPanelView: UIView {
  var onStop: (() -> Void)?
  var onCancel: (() -> Void)?
  var onAction: (() -> Void)?

  private var style: KeyboardStyle
  private let title = UILabel()
  private let detail = UILabel()
  private let meter = LevelMeterView()
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
    elapsed.font = .monospacedDigitSystemFont(ofSize: 14, weight: .medium)
    elapsed.textAlignment = .center
    [title, detail, meter, elapsed, spinner].forEach(addSubview)

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

  func applyStyle(_ style: KeyboardStyle) {
    self.style = style
    title.textColor = style.label
    detail.textColor = style.secondaryLabel
    elapsed.textColor = style.secondaryLabel
    meter.color = style.accent
    meter.idleColor = style.secondaryLabel.withAlphaComponent(0.35)
    stop.tintColor = style.accent
    action.tintColor = style.accent
    cancel.tintColor = style.label
    spinner.color = style.secondaryLabel
  }

  func set(_ state: DictationPanelState) {
    self.state = state
    clock?.invalidate()
    clock = nil
    action.isHidden = true
    stop.isHidden = true
    meter.isHidden = true
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
      meter.isHidden = false
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
    let seconds = max(0, Int(Date().timeIntervalSince(start)))
    elapsed.text = String(format: "%d:%02d", seconds / 60, seconds % 60)
  }

  func setLevels(_ levels: [Float]) {
    meter.levels = levels
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let width = bounds.width
    title.frame = CGRect(x: 16, y: 18, width: width - 32, height: 22)
    detail.frame = CGRect(x: 24, y: title.frame.maxY + 4, width: width - 48, height: 54)
    meter.frame = CGRect(x: 40, y: bounds.height * 0.32, width: width - 80, height: bounds.height * 0.3)
    elapsed.frame = CGRect(x: 0, y: meter.frame.maxY + 6, width: width, height: 18)
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

/// Rounded bars that follow the microphone level, newest on the right.
final class LevelMeterView: UIView {
  var color: UIColor = .systemBlue { didSet { setNeedsDisplay() } }
  var idleColor: UIColor = .gray { didSet { setNeedsDisplay() } }
  var levels: [Float] = [] { didSet { setNeedsDisplay() } }

  override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = false
    contentMode = .redraw
    isAccessibilityElement = true
    accessibilityLabel = "Microphone level"
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override func draw(_ rect: CGRect) {
    let count = 32
    let spacing: CGFloat = 3
    let barWidth = max(2, (bounds.width - spacing * CGFloat(count - 1)) / CGFloat(count))
    let recent = Array(levels.suffix(count))
    for index in 0..<count {
      let levelIndex = index - (count - recent.count)
      let level = levelIndex >= 0 ? CGFloat(recent[levelIndex]) : 0
      let height = max(barWidth, bounds.height * min(1, 0.08 + level * 0.92))
      let x = CGFloat(index) * (barWidth + spacing)
      let bar = UIBezierPath(roundedRect: CGRect(x: x, y: (bounds.height - height) / 2, width: barWidth, height: height), cornerRadius: barWidth / 2)
      (levelIndex >= 0 ? color : idleColor).setFill()
      bar.fill()
    }
  }
}
#endif
