import ExpoModulesCore
import UniformTypeIdentifiers

private final class FileImportException: GenericException<String>, @unchecked Sendable {
  override var reason: String { param }
}

public final class PulpoFileImportModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PulpoFileImport")

    AsyncFunction("importFile") { (source: URL) -> [String: Any] in
      guard source.isFileURL else { throw FileImportException("Choose a file to open in Pulpo.") }
      let scoped = source.startAccessingSecurityScopedResource()
      defer { if scoped { source.stopAccessingSecurityScopedResource() } }

      let manager = FileManager.default
      let documents = try manager.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      let root = documents.appendingPathComponent("incoming-files", isDirectory: true)
      var directory = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
      try manager.createDirectory(at: directory, withIntermediateDirectories: true)
      var completed = false
      defer { if !completed { try? manager.removeItem(at: directory) } }
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try directory.setResourceValues(values)

      var result: [String: Any]?
      var copyError: Error?
      var coordinationError: NSError?
      NSFileCoordinator().coordinate(readingItemAt: source, options: [], error: &coordinationError) { readable in
        do {
          let metadata = try readable.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey, .contentTypeKey])
          guard metadata.isRegularFile == true, metadata.isSymbolicLink != true else {
            throw FileImportException("Choose a file, rather than a folder or package.")
          }
          guard let size = metadata.fileSize, size > 0 else { throw FileImportException("Attachment is empty") }
          let name = source.lastPathComponent
          let destination = directory.appendingPathComponent(name)
          try manager.copyItem(at: readable, to: destination)
          let type = metadata.contentType ?? UTType(filenameExtension: source.pathExtension)
          result = ["uri": destination.absoluteString, "name": name,
                    "mimeType": type?.preferredMIMEType ?? "application/octet-stream", "size": size]
        } catch { copyError = error }
      }
      if let result, coordinationError == nil, copyError == nil {
        completed = true
        // iOS gives this app its own Inbox copy for document handoffs. The
        // durable import replaces that copy; never remove a provider's original.
        let inbox = documents.appendingPathComponent("Inbox", isDirectory: true).standardizedFileURL
        if source.deletingLastPathComponent().standardizedFileURL == inbox {
          try? manager.removeItem(at: source)
        }
        return result
      }
      if let error = copyError as? FileImportException { throw error }
      throw FileImportException("Pulpo couldn’t read this file. Save a copy to Files, then open that copy in Pulpo.")
    }
  }
}
