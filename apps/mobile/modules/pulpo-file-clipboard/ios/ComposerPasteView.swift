import ExpoModulesCore
import ObjectiveC
import UIKit
import UniformTypeIdentifiers

/// Wraps the composer's React Native text input so that pasting images or files
/// attaches them. The text view only pastes text: with a photo or a file on the
/// pasteboard, iOS doesn't even offer Paste.
///
/// The text view belongs to React Native, so it gets an instance-only subclass
/// (as PulpoDocEditorView does for its web view) that accepts the paste, saves
/// the items to files, and reports them through `onPasteFiles`. Loading can take
/// a while, so `onPasteStart` first reports the paste with the same `id`.
public final class ComposerPasteView: ExpoView {
  let onPasteStart = EventDispatcher()
  let onPasteFiles = EventDispatcher()

  private weak var textView: UITextView?

  public override func didAddSubview(_ subview: UIView) {
    super.didAddSubview(subview)
    attachToTextView()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    attachToTextView()
  }

  private func attachToTextView() {
    guard let found = Self.firstTextView(in: self), found !== textView else { return }
    textView = found
    ComposerPasteHook.install(on: found, owner: self)
  }

  private static func firstTextView(in view: UIView) -> UITextView? {
    for subview in view.subviews {
      if let textView = subview as? UITextView { return textView }
      if let nested = firstTextView(in: subview) { return nested }
    }
    return nil
  }

  /// Whether a paste into `textView` should go through this view. React Native
  /// recycles text inputs, so a hooked text view may now belong to another field.
  fileprivate func owns(_ textView: UITextView) -> Bool {
    textView.isEditable && textView.isDescendant(of: self)
  }

  fileprivate func paste(_ providers: [(NSItemProvider, UTType)]) {
    let id = UUID().uuidString
    onPasteStart(["id": id])
    ComposerPastedFiles.save(providers) { [weak self] files, failed in
      self?.onPasteFiles(["id": id, "files": files, "failed": failed])
    }
  }
}

private var composerPasteOwnerKey: UInt8 = 0

private final class WeakComposerPasteOwner {
  weak var view: ComposerPasteView?
  init(_ view: ComposerPasteView) { self.view = view }
}

private enum ComposerPasteHook {
  private static let prefix = "PulpoComposerPaste_"
  private static let canPerformSelector = #selector(UIResponder.canPerformAction(_:withSender:))
  private static let pasteSelector = #selector(UIResponderStandardEditActions.paste(_:))

  private typealias CanPerform = @convention(c) (AnyObject, Selector, Selector, AnyObject?) -> Bool
  private typealias Paste = @convention(c) (AnyObject, Selector, AnyObject?) -> Void

  static func install(on textView: UITextView, owner: ComposerPasteView) {
    objc_setAssociatedObject(textView, &composerPasteOwnerKey, WeakComposerPasteOwner(owner), .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    guard let base = object_getClass(textView) else { return }
    let baseName = NSStringFromClass(base)
    // Already ours: the associated owner above is all that changes.
    if baseName.hasPrefix(prefix) { return }
    let name = prefix + baseName
    if let existing = NSClassFromString(name) {
      object_setClass(textView, existing)
      return
    }
    guard let canPerformMethod = class_getInstanceMethod(base, canPerformSelector),
          let pasteMethod = class_getInstanceMethod(base, pasteSelector),
          let subclass = objc_allocateClassPair(base, name, 0) else { return }
    let originalCanPerform = unsafeBitCast(method_getImplementation(canPerformMethod), to: CanPerform.self)
    let originalPaste = unsafeBitCast(method_getImplementation(pasteMethod), to: Paste.self)

    let canPerform: @convention(block) (UITextView, Selector, AnyObject?) -> Bool = { view, action, sender in
      if action == pasteSelector, pasteOwner(of: view) != nil,
         ComposerPasteboard.hasAttachments(UIPasteboard.general) {
        return true
      }
      return originalCanPerform(view, canPerformSelector, action, sender)
    }
    let paste: @convention(block) (UITextView, AnyObject?) -> Void = { view, sender in
      let pasteText = { originalPaste(view, pasteSelector, sender) }
      guard let owner = pasteOwner(of: view) else { return pasteText() }
      let selection = ComposerPasteboard.selection(UIPasteboard.general.itemProviders)
      guard !selection.attachments.isEmpty else { return pasteText() }
      // As on the web, text copied along with the files still lands in the draft.
      if selection.hasOtherText { pasteText() }
      owner.paste(selection.attachments)
    }
    class_addMethod(subclass, canPerformSelector, imp_implementationWithBlock(canPerform), method_getTypeEncoding(canPerformMethod))
    class_addMethod(subclass, pasteSelector, imp_implementationWithBlock(paste), method_getTypeEncoding(pasteMethod))
    objc_registerClassPair(subclass)
    object_setClass(textView, subclass)
  }

  private static func pasteOwner(of textView: UITextView) -> ComposerPasteView? {
    guard let box = objc_getAssociatedObject(textView, &composerPasteOwnerKey) as? WeakComposerPasteOwner,
          let owner = box.view, owner.owns(textView) else { return nil }
    return owner
  }
}

/// Decides which pasteboard items are files to attach rather than text to insert.
enum ComposerPasteboard {
  /// Image formats chat models accept as they are. Other images are converted.
  static let modelImageTypes: [UTType] = [.png, .jpeg, .gif, .webP]

  /// Reads only the pasteboard's type metadata, which iOS allows without
  /// asking the user, so the edit menu can offer Paste for files.
  static func hasAttachments(_ pasteboard: UIPasteboard) -> Bool {
    guard pasteboard.numberOfItems > 0, let items = pasteboard.types(forItemSet: nil) else { return false }
    return items.contains { attachmentType(in: $0) != nil }
  }

  static func selection(_ providers: [NSItemProvider]) -> (attachments: [(NSItemProvider, UTType)], hasOtherText: Bool) {
    var attachments: [(NSItemProvider, UTType)] = []
    var hasOtherText = false
    for provider in providers {
      if let type = attachmentType(in: provider.registeredTypeIdentifiers) {
        attachments.append((provider, type))
      } else if provider.registeredTypeIdentifiers.contains(where: { UTType($0)?.conforms(to: .text) == true }) {
        hasOtherText = true
      }
    }
    return (attachments, hasOtherText)
  }

  /// The type to save one pasteboard item as, or nil when the item is text.
  ///
  /// Text copied from an editor always carries a plain-text string, even when the
  /// source also offers images or PDFs of it (as Pages does), so it stays text. A
  /// file copied in Files carries only its own type, such as `public.plain-text`
  /// for a .txt file, and Photos offers `public.png` or `public.jpeg`.
  static func attachmentType(in identifiers: [String]) -> UTType? {
    let types = identifiers.compactMap { UTType($0) }
    if types.contains(where: { $0 == .utf8PlainText || $0 == .utf16PlainText || $0 == .utf16ExternalPlainText }) {
      return nil
    }
    // Private renditions (like a Photos asset ID) have no filename extension.
    let files = types.filter {
      $0.isDeclared && !$0.isDynamic && $0.preferredFilenameExtension != nil
        && $0.conforms(to: .data) && !$0.conforms(to: .url)
    }
    let images = files.filter { $0.conforms(to: .image) }
    if !images.isEmpty {
      return modelImageTypes.first(where: { images.contains($0) }) ?? images[0]
    }
    return files.first
  }
}

/// Saves pasted items as files the composer can upload.
private enum ComposerPastedFiles {
  static func save(_ items: [(NSItemProvider, UTType)], completion: @escaping ([[String: Any]], Int) -> Void) {
    // Like the document picker's copies: the draft keeps these until they upload.
    let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let directory = caches.appendingPathComponent("pasted-files", isDirectory: true)
    let stamp = Int(Date().timeIntervalSince1970 * 1000)
    var results = [[String: Any]?](repeating: nil, count: items.count)
    let lock = NSLock()
    let group = DispatchGroup()
    for (index, (provider, type)) in items.enumerated() {
      group.enter()
      let fallback = items.count == 1 ? "\(stamp)" : "\(stamp)-\(index + 1)"
      provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
        // The provider deletes its file when this handler returns.
        let file = url.flatMap { try? copy($0, type: type, name: provider.suggestedName, fallback: fallback, into: directory) }
        lock.lock()
        results[index] = file
        lock.unlock()
        group.leave()
      }
    }
    group.notify(queue: .main) {
      let files = results.compactMap { $0 }
      completion(files, items.count - files.count)
    }
  }

  private static func copy(_ source: URL, type: UTType, name suggested: String?, fallback: String, into directory: URL) throws -> [String: Any] {
    let manager = FileManager.default
    // Each file gets its own folder, so pasted files keep their names.
    let folder = directory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try manager.createDirectory(at: folder, withIntermediateDirectories: true)
    var saved = false
    defer { if !saved { try? manager.removeItem(at: folder) } }

    var savedType = type
    var data: Data?
    // HEIC, TIFF and the like: save a copy chat models can read. Images UIKit
    // can't decode, such as SVG, attach unchanged, like any other file.
    if type.conforms(to: .image), !ComposerPasteboard.modelImageTypes.contains(type),
       let image = UIImage(contentsOfFile: source.path) {
      if let alpha = image.cgImage?.alphaInfo, ![.none, .noneSkipFirst, .noneSkipLast].contains(alpha) {
        if let png = image.pngData() { data = png; savedType = .png }
      } else if let jpeg = image.jpegData(compressionQuality: 0.9) {
        data = jpeg
        savedType = .jpeg
      }
    }

    let name = fileName(suggested, type: savedType, fallback: savedType.conforms(to: .image) ? "image-\(fallback)" : "file-\(fallback)")
    let destination = folder.appendingPathComponent(name)
    if let data {
      try data.write(to: destination)
    } else {
      try manager.copyItem(at: source, to: destination)
    }
    let size = (try manager.attributesOfItem(atPath: destination.path)[.size] as? NSNumber)?.intValue ?? 0
    saved = true
    return [
      "uri": destination.absoluteString,
      "name": name,
      "mimeType": savedType.preferredMIMEType ?? "application/octet-stream",
      "size": size,
    ]
  }

  /// The suggested name, given the saved type's extension when it lacks a matching one.
  static func fileName(_ suggested: String?, type: UTType, fallback: String) -> String {
    let cleaned = (suggested ?? "")
      .replacingOccurrences(of: "/", with: "-")
      .replacingOccurrences(of: ":", with: "-")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let base = cleaned.isEmpty || cleaned.hasPrefix(".") ? fallback : cleaned
    let current = (base as NSString).pathExtension
    if !current.isEmpty, let existing = UTType(filenameExtension: current), existing.conforms(to: type) {
      return base
    }
    guard let ext = type.preferredFilenameExtension else { return base }
    // A converted image keeps its name but takes the new format's extension.
    let stem = !current.isEmpty && UTType(filenameExtension: current)?.conforms(to: .image) == true
      ? (base as NSString).deletingPathExtension
      : base
    return "\(stem).\(ext)"
  }
}
