import Foundation

struct Draft: Codable {
    var text = ""
    var pending: Submission?
}
struct DraftCache {
    let url: URL
    init(scope: String, directory: URL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]) {
        url = directory.appendingPathComponent("pulpo-tv-\(scope).json")
    }
    func load() -> [String: Draft] {
        guard let data = try? Data(contentsOf: url) else { return [:] }
        return (try? JSONDecoder().decode([String: Draft].self, from: data)) ?? [:]
    }
    func save(_ drafts: [String: Draft]) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(drafts).write(to: url, options: .atomic)
    }
    func clear() { try? FileManager.default.removeItem(at: url) }
}
