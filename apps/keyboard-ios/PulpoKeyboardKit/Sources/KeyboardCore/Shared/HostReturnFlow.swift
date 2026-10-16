/// Coordinates host opening without letting a delayed fallback outlive the
/// dictation attempt that authorized it. An already issued open cannot be undone.
@MainActor
public enum HostReturnFlow {
  public enum Method: String {
    case workspace, urlScheme = "url-scheme", none
  }

  public static func open(
    isAuthorized: @escaping () -> Bool,
    openWorkspace: () -> Bool,
    confirmLeft: (@escaping (Bool) -> Void) -> Void,
    openScheme: @escaping (@escaping (Bool) -> Void) -> Void,
    completion: @escaping (Method) -> Void
  ) {
    let fallback = {
      guard isAuthorized() else { return }
      openScheme { opened in
        guard isAuthorized() else { return }
        completion(opened ? .urlScheme : .none)
      }
    }
    guard isAuthorized() else { return }
    if openWorkspace() {
      confirmLeft { left in
        guard isAuthorized() else { return }
        if left { completion(.workspace) } else { fallback() }
      }
    } else {
      fallback()
    }
  }
}
