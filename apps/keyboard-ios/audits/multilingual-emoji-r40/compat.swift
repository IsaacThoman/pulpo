import Foundation
@main struct Compatibility {
 static func main() throws {
  let args = CommandLine.arguments
  let catalog = try EmojiCatalog.load(url: URL(fileURLWithPath: args[1]))
  let index = EmojiSuggester(catalog: catalog)
  let queries = try JSONDecoder().decode([String].self, from: Data(contentsOf: URL(fileURLWithPath: args[2])))
  var rows: [[String: Any]] = []
  for query in queries {
   rows.append(["query": query, "search": index.search(query).map(\.value), "suggestions": index.suggestions(for: query).map(\.value), "exactSuggestions": index.suggestions(for: query, limit: 8, prefixes: false).map(\.value)])
  }
  try JSONSerialization.data(withJSONObject: rows, options: [.sortedKeys]).write(to: URL(fileURLWithPath: args[3]))
 }
}
