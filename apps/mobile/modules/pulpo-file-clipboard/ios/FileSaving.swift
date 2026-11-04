import ExpoModulesCore
import Photos
import UIKit

private func savingError(_ name: String, _ description: String, _ code: String) -> Exception {
  Exception(name: name, description: description, code: code)
}

private func missingFileError() -> Exception {
  savingError("FileSaveMissingFile", "The file is no longer available.", "ERR_FILE_SAVE_MISSING_FILE")
}

/// Checks that `uri` is a local file that still exists.
func requireLocalFile(_ uri: URL) throws {
  guard uri.isFileURL, FileManager.default.fileExists(atPath: uri.path) else { throw missingFileError() }
}

/// Saves an image file into the photo library, asking only for add access.
func saveImageToPhotos(_ uri: URL, promise: Promise) {
  do { try requireLocalFile(uri) } catch { promise.reject(error); return }
  PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
    guard status == .authorized || status == .limited else {
      promise.reject(savingError(
        "PhotosAccessDenied",
        "Pulpo can’t save to Photos. Allow it in Settings › Pulpo › Photos.",
        "ERR_PHOTOS_ACCESS_DENIED"
      ))
      return
    }
    // The original bytes keep the format (PNG, GIF, HEIC); formats Photos won't take as-is are
    // decoded and saved as a plain image instead.
    PHPhotoLibrary.shared().performChanges({
      PHAssetCreationRequest.forAsset().addResource(with: .photo, fileURL: uri, options: nil)
    }) { saved, _ in
      if saved { promise.resolve(nil); return }
      guard let image = UIImage(contentsOfFile: uri.path) else {
        promise.reject(savingError("PhotosUnsupported", "Photos can’t save this image type.", "ERR_PHOTOS_UNSUPPORTED"))
        return
      }
      PHPhotoLibrary.shared().performChanges({
        PHAssetChangeRequest.creationRequestForAsset(from: image)
      }) { saved, error in
        if saved { promise.resolve(nil) }
        else { promise.reject(savingError("PhotosSaveFailed", error?.localizedDescription ?? "The image couldn’t be saved.", "ERR_PHOTOS_SAVE_FAILED")) }
      }
    }
  }
}

/// Resolves once the export picker closes: `true` when the file was saved, `false` when cancelled.
private final class FileExportCoordinator: NSObject, UIDocumentPickerDelegate {
  private var promise: Promise?
  private let cleanup: () -> Void
  // The picker holds its delegate weakly; the coordinator keeps itself alive until it finishes.
  private var retainedSelf: FileExportCoordinator?

  init(promise: Promise, cleanup: @escaping () -> Void) {
    self.promise = promise
    self.cleanup = cleanup
    super.init()
    retainedSelf = self
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    finish(saved: true)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    finish(saved: false)
  }

  func finish(saved: Bool) {
    guard let promise else { return }
    self.promise = nil
    cleanup()
    promise.resolve(saved)
    retainedSelf = nil
  }
}

/// Lets the user pick where in Files (iCloud Drive, On My iPhone, …) a copy of the file goes.
/// The copy carries `name`, since cached files may be stored under another one.
func exportFile(_ uri: URL, name: String, presenter: UIViewController?, promise: Promise) {
  do { try requireLocalFile(uri) } catch { promise.reject(error); return }
  guard let presenter else {
    promise.reject(savingError("FileExportUnavailable", "The save sheet couldn’t be shown.", "ERR_FILE_EXPORT_UNAVAILABLE"))
    return
  }
  var exported = uri
  var staging: URL?
  let fileName = (name as NSString).lastPathComponent
  if !fileName.isEmpty, fileName != uri.lastPathComponent {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("pulpo-export-\(UUID().uuidString)", isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      let destination = directory.appendingPathComponent(fileName)
      try FileManager.default.copyItem(at: uri, to: destination)
      exported = destination
      staging = directory
    } catch {
      try? FileManager.default.removeItem(at: directory)
    }
  }
  let coordinator = FileExportCoordinator(promise: promise) {
    if let staging { try? FileManager.default.removeItem(at: staging) }
  }
  let picker = UIDocumentPickerViewController(forExporting: [exported], asCopy: true)
  picker.delegate = coordinator
  presenter.present(picker, animated: true)
}
