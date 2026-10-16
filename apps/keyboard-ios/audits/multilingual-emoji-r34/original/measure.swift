import Foundation
import Darwin

private func clockMS() -> Double { Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000 }
private func rss() -> Int {
  var info = mach_task_basic_info()
  var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
  let status = withUnsafeMutablePointer(to: &info) { pointer in
    pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
      task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
    }
  }
  return status == KERN_SUCCESS ? Int(info.resident_size) : -1
}
private func peak() -> Int { var x = rusage(); getrusage(RUSAGE_SELF, &x); return Int(x.ru_maxrss) }
private func percentile(_ xs: [Double], _ p: Double) -> Double { xs.sorted()[min(xs.count - 1, Int(ceil(Double(xs.count) * p)) - 1)] }
@main struct Measure {
 static func main() throws {
  let args = CommandLine.arguments
  let catalog = try EmojiCatalog.load(url: URL(fileURLWithPath: args[1]))
  let queries = try JSONDecoder().decode([String].self, from: Data(contentsOf: URL(fileURLWithPath: args[2])))
  precondition(!queries.isEmpty)
  let before = rss(), begin = clockMS()
  let index = EmojiSuggester(catalog: catalog)
  let construction = clockMS() - begin, singleton = rss()
  var checksum = 0
  for q in queries { checksum += index.search(q).count }
  var samples: [Double] = []
  for i in 0..<1200 {
   let t = clockMS()
   let result = index.search(queries[i % queries.count])
   checksum += result.reduce(0) { $0 + $1.value.utf8.count }
   samples.append(clockMS() - t)
  }
  let singlePeak = peak(), beforeStress = rss()
  var retained: [EmojiSuggester] = []
  for _ in 0..<15 { retained.append(EmojiSuggester(catalog: catalog)) }
  let afterStress = rss()
  for x in retained { checksum += x.search(queries[0]).count }
  let output: [String: Any] = ["constructionMS": construction, "queryMedianMS": percentile(samples, 0.5), "queryP95MS": percentile(samples, 0.95), "queryMaxMS": samples.max()!, "queryMinMS": samples.min()!, "queries": samples.count, "rssBefore": before, "rssSingleton": singleton, "singletonPeak": singlePeak, "rssBeforeStress": beforeStress, "rssAfterStress": afterStress, "additionalRetainedPerIndex": Double(afterStress - beforeStress)/15, "stressPeak": peak(), "checksum": checksum, "rawQueryMS": samples]
  try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys]).write(to: URL(fileURLWithPath: args[3]))
 }
}
