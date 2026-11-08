import ExpoModulesCore
import ExpoUI
import SwiftUI

/// Shows a control's label in the Large Content Viewer (touch and hold at accessibility text sizes)
/// for controls that keep a fixed size instead of growing with Dynamic Type.
struct LargeContentViewerModifier: ViewModifier, Record {
  @Field var title: String = ""
  @Field var systemImage: String?

  func body(content: Content) -> some View {
    content.accessibilityShowsLargeContentViewer {
      if let systemImage, !systemImage.isEmpty {
        Label(title, systemImage: systemImage)
      } else {
        Text(title)
      }
    }
  }
}

enum PulpoSwiftUIModifiers {
  static func register() {
    ViewModifierRegistry.register("pulpoLargeContentViewer") { params, appContext, _ in
      try LargeContentViewerModifier(from: params, appContext: appContext)
    }
  }
}
