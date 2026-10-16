import Foundation
// Foundation/path metadata only; never opens file contents or product modules.
let fm = FileManager.default
let input = CommandLine.arguments[1]
let directory = URL(fileURLWithPath: input, isDirectory: true)
let canonical = directory.resolvingSymlinksInPath().standardizedFileURL
var observed: [[String:Any]] = []
if let e = fm.enumerator(at: directory, includingPropertiesForKeys: nil) {
  for case let u as URL in e {
    let normalized = u.resolvingSymlinksInPath().standardizedFileURL
    observed.append(["path":u.path,"absoluteString":u.absoluteString,
      "originalPrefixMatches":u.path.hasPrefix(directory.path + "/"),
      "canonicalPath":normalized.path,
      "canonicalPrefixMatches":normalized.path.hasPrefix(canonical.path + "/")])
  }
}
let result: [String:Any] = ["input":input,"directoryPath":directory.path,"directoryAbsoluteString":directory.absoluteString,
 "directoryResolvedPath":canonical.path,"temporaryDirectoryPath":fm.temporaryDirectory.path,
 "temporaryDirectoryResolvedPath":fm.temporaryDirectory.resolvingSymlinksInPath().path,"observed":observed]
let data = try JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys])
print(String(data:data,encoding:.utf8)!)
