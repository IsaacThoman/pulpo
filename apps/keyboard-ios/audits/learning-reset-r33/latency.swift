import Foundation

@main struct Latency {
 static func main() throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent("pulpo-r33-latency-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }
  let url=root.appendingPathComponent("PersonalDictionary.json")
  let personal=PersonalDictionary(url:url)
  func time(_ operation: ()->Void)->Double { let s=DispatchTime.now().uptimeNanoseconds; operation(); return Double(DispatchTime.now().uptimeNanoseconds-s)/1e6 }
  func stats(_ values:[Double])->[String:Double] { let s=values.sorted(); return ["p50":s[s.count/2],"p95":s[min(s.count-1,s.count*95/100)],"max":s.last!] }
  // Seed maximum personal vocabulary/pairs through actual public learning paths.
  for i in 0..<5000 {
   for j in 0..<4 { personal.learn("r33perf\(i)",after:"history\(j)") }
   if i % 50 == 49 { personal.save() }
  }
  personal.save()
  var words:[Double]=[], queries:[Double]=[], commits:[Double]=[]
  for i in 0..<200 {
   words.append(time { personal.learn("r33perf\(i)",after:"history\(i%4)") })
   queries.append(time { for _ in 0..<100 { _=personal.count(of:"r33perf\(i)"); _=personal.isKnown("r33perf\(i)") } })
   if i % 20 == 19 { commits.append(time { personal.save() }) }
  }
  let clear=time { personal.clear() }
  print(String(data:try JSONSerialization.data(withJSONObject:["wordMilliseconds":stats(words),"hundredQueriesMilliseconds":stats(queries),"commitMilliseconds":stats(commits),"dictionaryClearMilliseconds":clear],options:[.prettyPrinted,.sortedKeys]),encoding:.utf8)!)
 }
}
