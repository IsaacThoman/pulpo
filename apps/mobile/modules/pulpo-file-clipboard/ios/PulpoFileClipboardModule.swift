import ExpoModulesCore
import UIKit

private final class ClipboardFileNotFoundException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "The file does not exist at \(param)"
  }
}

private final class ClipboardItemProviderException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "Could not create a pasteboard item provider for \(param)"
  }
}

public final class PulpoFileClipboardModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PulpoFileClipboard")

    AsyncFunction("copyFile") { (uri: URL) in
      guard uri.isFileURL, FileManager.default.fileExists(atPath: uri.path) else {
        throw ClipboardFileNotFoundException(uri.absoluteString)
      }
      guard let provider = NSItemProvider(contentsOf: uri) else {
        throw ClipboardItemProviderException(uri.absoluteString)
      }
      UIPasteboard.general.setItemProviders([provider], localOnly: false, expirationDate: nil)
    }
    .runOnQueue(DispatchQueue.main)
  }
}
