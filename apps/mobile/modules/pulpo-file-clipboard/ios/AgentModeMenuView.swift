import ExpoModulesCore
import SwiftUI

struct AgentModeMenuConfiguration: Record {
  @Field var scope: String = ""
  @Field var revision: Int = 0
  @Field var enabled: Bool = false
  @Field var available: Bool = false
  @Field var hint: String = ""
}

public final class AgentModeMenuView: ExpoView {
  let onSelectionChange = EventDispatcher()
  private let model = AgentModeMenuModel()
  private var hostingController: UIViewController?

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = false
    let host = UIHostingController(rootView: AgentModeMenuContent(model: model) { [weak self] selection in
      UISelectionFeedbackGenerator().selectionChanged()
      self?.onSelectionChange([
        "enabled": selection.enabled,
        "revision": selection.revision,
        "scope": selection.scope
      ])
    })
    host.safeAreaRegions = []
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

  func configure(_ value: AgentModeMenuConfiguration) {
    var selection = model.selection
    selection.reconcile(enabled: value.enabled, scope: value.scope, revision: value.revision)
    if selection != model.selection { model.selection = selection }
    if model.available != value.available { model.available = value.available }
    if model.hint != value.hint { model.hint = value.hint }
  }
}
