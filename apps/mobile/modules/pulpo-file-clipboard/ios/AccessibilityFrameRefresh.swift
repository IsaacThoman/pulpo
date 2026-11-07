import UIKit

/// SwiftUI reports a hosted control's accessibility frame from where it was at its last layout.
/// The composer rides the keyboard and the chat slides with the drawer through transforms, which
/// lay nothing out, so VoiceOver (and Voice Control, Switch Control) found the Send, Add attachment
/// and Agent buttons where they were before the keyboard moved: behind it, or off screen.
/// Once a move settles, make SwiftUI place its hosting views again and tell assistive technologies.
/// (Verified in the simulator: the composer buttons and the drawer's Settings button report their
/// drawn frames after the keyboard hides and the drawer slides; before, they kept the old ones.)
enum AccessibilityFrameRefresh {
  private static var observers: [NSObjectProtocol] = []

  static func observeKeyboard() {
    guard observers.isEmpty else { return }
    let center = NotificationCenter.default
    // "Did" notifications arrive after the keyboard animation, when the transforms have settled.
    observers = [UIResponder.keyboardDidShowNotification, UIResponder.keyboardDidHideNotification].map { name in
      center.addObserver(forName: name, object: nil, queue: .main) { _ in refresh() }
    }
  }

  static func refresh() {
    let windows = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
    var count = 0
    for window in windows where !window.isHidden {
      count += relayoutHostingViews(in: window)
    }
    guard count > 0 else { return }
    UIAccessibility.post(notification: .layoutChanged, argument: nil)
  }

  private static func relayoutHostingViews(in view: UIView) -> Int {
    var count = 0
    // SwiftUI's own hosting view (`_UIHostingView<…>`): only a change of its frame makes SwiftUI
    // recompute where its content sits on screen. Move it by a point and back within this
    // run loop turn, so nothing is drawn in between.
    if NSStringFromClass(type(of: view)).contains("_UIHostingView") {
      let frame = view.frame
      view.frame = frame.offsetBy(dx: 1, dy: 0)
      view.layoutIfNeeded()
      view.frame = frame
      view.layoutIfNeeded()
      count += 1
    }
    for subview in view.subviews where !subview.isHidden {
      count += relayoutHostingViews(in: subview)
    }
    return count
  }
}
