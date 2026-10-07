import PulpoKit
import SwiftUI

/// Decoded attachment images, shared across views.
final class ImageCache: @unchecked Sendable {
    static let shared = ImageCache()
    private let cache = NSCache<NSString, UIImage>()

    init() {
        cache.countLimit = 120
    }

    func image(for key: String) -> UIImage? { cache.object(forKey: key as NSString) }
    func insert(_ image: UIImage, for key: String) { cache.setObject(image, forKey: key as NSString) }
}

/// An attachment's image, loaded with the session token (so `AsyncImage`
/// can't be used). `full` fetches the original instead of the thumbnail.
struct AttachmentImage: View {
    let attachment: AttachmentReference
    let api: PulpoAPI
    var full = false
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: full ? .fit : .fill)
                    .transition(.opacity)
            } else if failed {
                VStack(spacing: 12) {
                    Image(systemName: "photo")
                        .font(.title2)
                    Text(attachment.name).font(.caption).lineLimit(1)
                }
                .foregroundStyle(Theme.secondaryText)
                .padding()
            } else {
                ProgressView()
            }
        }
        .animation(.easeOut(duration: 0.2), value: image != nil)
        .task(id: attachment.id) { await load() }
        .accessibilityLabel(Text(attachment.name))
    }

    private var cacheKey: String { "\(api.server.url.absoluteString)|\(attachment.id)|\(full ? "full" : "thumb")" }

    private func load() async {
        if let cached = ImageCache.shared.image(for: cacheKey) {
            image = cached
            return
        }
        do {
            let data = full ? try await api.attachmentData(attachment.id) : try await api.thumbnailData(attachment.id)
            guard let decoded = await Self.decode(data) else {
                failed = true
                return
            }
            ImageCache.shared.insert(decoded, for: cacheKey)
            image = decoded
        } catch {
            failed = true
        }
    }

    /// Decodes off the main thread; large generated images are slow to inflate.
    private static func decode(_ data: Data) async -> UIImage? {
        await Task.detached(priority: .userInitiated) {
            UIImage(data: data)?.preparingForDisplay()
        }.value
    }
}

/// A full-screen view of one image.
struct ImageViewer: View {
    let attachment: AttachmentReference
    let api: PulpoAPI
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            AttachmentImage(attachment: attachment, api: api, full: true)
                .padding(60)
        }
        .onExitCommand { dismiss() }
    }
}
