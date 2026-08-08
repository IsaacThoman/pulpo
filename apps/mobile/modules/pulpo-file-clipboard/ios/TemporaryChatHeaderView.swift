import ExpoModulesCore
import SwiftUI

@available(iOS 26.0, *)
private final class TemporaryChatHeaderModel: ObservableObject {
  @Published var active = false
  @Published var expanded = false
  @Published var saving = false
  @Published var saveDisabled = false
  var reduceMotion = false
}

@available(iOS 26.0, *)
private struct PulpoGhostShape: Shape {
  func path(in rect: CGRect) -> Path {
    let sx = rect.width / 24
    let sy = rect.height / 24
    func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
      CGPoint(x: x * sx, y: y * sy)
    }

    var path = Path()
    path.move(to: point(12, 2))
    path.addCurve(to: point(20, 10), control1: point(16.42, 2), control2: point(20, 5.58))
    path.addLine(to: point(20, 22))
    path.addLine(to: point(17, 19))
    path.addLine(to: point(14.5, 21.5))
    path.addLine(to: point(12, 19))
    path.addLine(to: point(9.5, 21.5))
    path.addLine(to: point(7, 19))
    path.addLine(to: point(4, 22))
    path.addLine(to: point(4, 10))
    path.addCurve(to: point(12, 2), control1: point(4, 5.58), control2: point(7.58, 2))
    path.closeSubpath()
    path.move(to: point(9, 10))
    path.addLine(to: point(9.01, 10))
    path.move(to: point(15, 10))
    path.addLine(to: point(15.01, 10))
    return path
  }
}

@available(iOS 26.0, *)
private struct TemporaryChatHeaderContent: View {
  @ObservedObject var model: TemporaryChatHeaderModel
  let onToggleTemporary: () -> Void
  let onSave: () -> Void
  let onNewChat: () -> Void

  @Environment(\.colorScheme) private var colorScheme
  @Namespace private var glassNamespace

  private var spring: Animation {
    model.reduceMotion ? .linear(duration: 0) : .spring(response: 0.42, dampingFraction: 0.84)
  }

  private var glassTint: Color? {
    model.active ? Color(red: 0.686, green: 0.322, blue: 0.871).opacity(0.22) : nil
  }

  private var iconColor: Color {
    colorScheme == .dark ? .white : .black
  }

  var body: some View {
    GlassEffectContainer(spacing: 8) {
      HStack(spacing: 0) {
        Button(action: onSave) {
          ZStack {
            Image(systemName: "bookmark")
              .font(.system(size: 18))
              .opacity(model.saving ? 0 : 1)

            ProgressView()
              .controlSize(.small)
              .opacity(model.saving ? 1 : 0)
          }
          .frame(width: 44, height: 44)
          .foregroundStyle(iconColor)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(width: model.expanded ? 44 : 0, height: 44)
        .opacity(model.expanded ? 1 : 0)
        .scaleEffect(model.expanded ? 1 : 0.78)
        .clipped()
        .disabled(!model.expanded || model.saveDisabled || model.saving)
        .accessibilityHidden(!model.expanded)
        .accessibilityLabel(model.saving ? "Saving chat" : "Save chat")

        Button(action: model.expanded ? onNewChat : onToggleTemporary) {
          ZStack {
            PulpoGhostShape()
              .stroke(style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
              .frame(width: 18, height: 18)
              .opacity(model.expanded ? 0 : 1)
              .scaleEffect(model.expanded ? 0.72 : 1)

            Image(systemName: "square.and.pencil")
              .font(.system(size: 18))
              .opacity(model.expanded ? 1 : 0)
              .scaleEffect(model.expanded ? 1 : 0.72)
          }
          .frame(width: 44, height: 44)
          .foregroundStyle(iconColor)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(model.expanded ? "New temporary chat" : (model.active ? "Disable temporary chat" : "Enable temporary chat"))
      }
      .frame(width: model.expanded ? 88 : 44, height: 44, alignment: .trailing)
      .glassEffect(.regular.tint(glassTint).interactive(), in: Capsule())
      .glassEffectID("temporary-chat-header", in: glassNamespace)
      .animation(spring, value: model.expanded)
      .animation(spring, value: model.saving)
    }
    .frame(maxWidth: .infinity, minHeight: 44, maxHeight: 44, alignment: .trailing)
  }
}

public final class TemporaryChatHeaderView: ExpoView {
  let onToggleTemporary = EventDispatcher()
  let onSave = EventDispatcher()
  let onNewChat = EventDispatcher()

  @available(iOS 26.0, *)
  private lazy var model = TemporaryChatHeaderModel()
  private var hostingController: UIViewController?

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = false
    mountContent()
  }

  private func mountContent() {
    guard #available(iOS 26.0, *) else { return }
    let content = TemporaryChatHeaderContent(
      model: model,
      onToggleTemporary: { [weak self] in self?.onToggleTemporary([:]) },
      onSave: { [weak self] in self?.onSave([:]) },
      onNewChat: { [weak self] in self?.onNewChat([:]) }
    )
    let host = UIHostingController(rootView: content)
    host.view.backgroundColor = .clear
    host.view.translatesAutoresizingMaskIntoConstraints = false
    addSubview(host.view)
    NSLayoutConstraint.activate([
      host.view.topAnchor.constraint(equalTo: topAnchor),
      host.view.bottomAnchor.constraint(equalTo: bottomAnchor),
      host.view.leadingAnchor.constraint(equalTo: leadingAnchor),
      host.view.trailingAnchor.constraint(equalTo: trailingAnchor)
    ])
    hostingController = host
  }

  public func setActive(_ value: Bool) {
    guard #available(iOS 26.0, *), model.active != value else { return }
    model.active = value
  }

  public func setExpanded(_ value: Bool) {
    guard #available(iOS 26.0, *), model.expanded != value else { return }
    let animation: Animation? = model.reduceMotion ? nil : .spring(response: 0.42, dampingFraction: 0.84)
    withAnimation(animation) {
      model.expanded = value
    }
  }

  public func setSaving(_ value: Bool) {
    guard #available(iOS 26.0, *), model.saving != value else { return }
    withAnimation(model.reduceMotion ? nil : .easeInOut(duration: 0.16)) {
      model.saving = value
    }
  }

  public func setSaveDisabled(_ value: Bool) {
    guard #available(iOS 26.0, *) else { return }
    model.saveDisabled = value
  }

  public func setReduceMotion(_ value: Bool) {
    guard #available(iOS 26.0, *) else { return }
    model.reduceMotion = value
  }
}
