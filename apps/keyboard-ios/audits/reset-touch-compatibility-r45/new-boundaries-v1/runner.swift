import Foundation
import KeyboardCore
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

// Fixed independent boundary runner. No source access, reflection, private symbols,
// model-derived fixtures, retries, background saves, or concurrent operations.
struct FixtureSet: Decodable {
    let schemaVersion: Int
    let busyRetryCount: Int
    let offsetAbsoluteTolerance: Double
    let offsetRelativeTolerance: Double
    let uniqueFamilyCount: Int
    let instanceCount: Int
    let plannedCheckCount: Int
    let families: [Family]
}
struct Family: Decodable { let id: String; let rationale: String; let instances: [Instance] }
struct Instance: Decodable {
    let id: String; let mode: String; let steps: [Step]
    let roundTrip: Bool; let nilSave: Bool; let plannedCheckCount: Int
}
struct Step: Decodable {
    let payload: Payload; let control: Payload?; let expectedAccepted: Bool
    let weightRule: String; let statusRule: String?; let settleAfter: Bool
    let learning: Bool?; let expectedActualSamples: Int
}
struct Payload: Decodable {
    let text: String; let intended: String; let taps: [Tap?]
    let normalizedText: String?
}
struct Tap: Decodable {
    let key: String; let dx: Scalar; let dy: Scalar
}
enum Scalar: Decodable {
    case finite(Double), special(String)
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let d = try? c.decode(Double.self) { self = .finite(d) }
        else { self = .special(try c.decode(String.self)) }
    }
    func value() throws -> Double {
        switch self {
        case .finite(let d): guard d.isFinite else { throw Failure("nonfinite JSON number") }; return d
        case .special(let s):
            switch s {
            case "nan": return .nan
            case "+inf": return .infinity
            case "-inf": return -.infinity
            default: throw Failure("unknown symbolic scalar")
            }
        }
    }
}
struct Failure: Error, CustomStringConvertible {
    let description: String
    init(_ s: String) { description = s }
}
struct Busy: Error { let operation: String }
func number(_ d: Double) -> Any {
    if d.isNaN { return "nan" }
    if d == .infinity { return "+inf" }
    if d == -.infinity { return "-inf" }
    return d
}
struct State {
    let weight: Double
    let offsets: [KeyPoint]
    init(_ model: TouchModel) { weight = model.weight; offsets = model.offsets }
    var json: [String: Any] {
        ["weight": number(weight), "weightBits": String(weight.bitPattern),
         "offsets": offsets.map { ["x": number($0.x), "y": number($0.y),
                                  "xBits": String($0.x.bitPattern), "yBits": String($0.y.bitPattern)] }]
    }
    func exactWeight(_ other: State) -> Bool { weight.bitPattern == other.weight.bitPattern }
    func exactOffsets(_ other: State) -> Bool {
        offsets.count == other.offsets.count && zip(offsets, other.offsets).allSatisfy {
            $0.x.bitPattern == $1.x.bitPattern && $0.y.bitPattern == $1.y.bitPattern
        }
    }
    func equivalentWeight(_ other: State, _ absTol: Double, _ relTol: Double) -> Bool {
        close(weight, other.weight, absTol, relTol)
    }
    func equivalentOffsets(_ other: State, _ absTol: Double, _ relTol: Double) -> Bool {
        offsets.count == other.offsets.count && zip(offsets, other.offsets).allSatisfy {
            close($0.x, $1.x, absTol, relTol) && close($0.y, $1.y, absTol, relTol)
        }
    }
}
func close(_ a: Double, _ b: Double, _ absTol: Double, _ relTol: Double) -> Bool {
    a.isFinite && b.isFinite && abs(a - b) <= absTol + relTol * max(abs(a), abs(b))
}
// Exact timestamps use stat seconds AND nanoseconds; inode/device and raw bytes
// are captured. atime is deliberately omitted. Symlinks are never traversed.
struct Entry: Equatable {
    let kind: UInt32; let inode: UInt64; let device: UInt64
    let modifiedSeconds: Int64; let modifiedNanoseconds: Int64
    let bytes: Data?; let symlink: String?
    var json: [String: Any] {
        ["kind": kind, "inode": String(inode), "device": String(device),
         "mtimeSeconds": String(modifiedSeconds), "mtimeNanoseconds": String(modifiedNanoseconds),
         "bytesBase64": bytes?.base64EncodedString() as Any? ?? NSNull(),
         "symlink": symlink as Any? ?? NSNull()]
    }
}
struct Files: Equatable {
    let entries: [String: Entry]
    var json: [String: Any] { entries.mapValues { $0.json } }
}
func captureFiles(_ root: URL) throws -> Files {
    var found: [String: Entry] = [:]
    func visit(_ url: URL, _ relative: String) throws {
        var info = stat()
        guard lstat(url.path, &info) == 0 else { throw Failure("lstat failed at \(relative): \(errno)") }
        let kind = UInt32(info.st_mode) & UInt32(S_IFMT)
        #if canImport(Darwin)
        let sec = Int64(info.st_mtimespec.tv_sec)
        let nsec = Int64(info.st_mtimespec.tv_nsec)
        #else
        let sec = Int64(info.st_mtim.tv_sec)
        let nsec = Int64(info.st_mtim.tv_nsec)
        #endif
        let bytes: Data? = kind == UInt32(S_IFREG) ? try Data(contentsOf: url) : nil
        let link: String? = kind == UInt32(S_IFLNK) ? try FileManager.default.destinationOfSymbolicLink(atPath: url.path) : nil
        found[relative] = Entry(kind: kind, inode: UInt64(info.st_ino), device: UInt64(info.st_dev),
                                modifiedSeconds: sec, modifiedNanoseconds: nsec, bytes: bytes, symlink: link)
        if kind == UInt32(S_IFDIR) {
            for child in try FileManager.default.contentsOfDirectory(atPath: url.path).sorted() {
                try visit(url.appendingPathComponent(child), relative == "." ? child : relative + "/" + child)
            }
        }
    }
    try visit(root, ".")
    return Files(entries: found)
}
struct Check {
    let id: String
    let expected: String
    var status = "pending"
    var actual: Any = NSNull()
    var json: [String: Any] { ["id": id, "expected": expected, "status": status, "actual": actual] }
}
final class Ledger {
    private(set) var checks: [Check] = []
    var events: [[String: Any]] = []
    func add(_ id: String, _ expected: String) { checks.append(Check(id: id, expected: expected)) }
    func check(_ id: String, _ passed: Bool, _ actual: Any = NSNull()) {
        guard let i = checks.firstIndex(where: { $0.id == id }), checks[i].status == "pending" else {
            // A runner bookkeeping error is preserved as an additional explicit error.
            var item = Check(id: "runner.bookkeeping.\(checks.count)", expected: "one planned result per check")
            item.status = "error"; item.actual = id; checks.append(item); return
        }
        checks[i].status = passed ? "pass" : "fail"; checks[i].actual = actual
    }
    func finishPending(_ status: String, _ reason: String) {
        for i in checks.indices where checks[i].status == "pending" { checks[i].status = status; checks[i].actual = reason }
    }
    var counts: [String: Int] {
        var c = ["check": checks.count, "pass": 0, "fail": 0, "unavailable": 0, "error": 0]
        for item in checks { c[item.status, default: 0] += 1 }
        return c
    }
    var json: [String: Any] { ["counts": counts, "checks": checks.map { $0.json }, "events": events] }
}
func plan(_ input: Instance) -> Ledger {
    let l = Ledger()
    if input.mode == "memory" { l.add("constructor.files", "nil URL creates no cwd entries and changes no cwd metadata") }
    l.add("control.constructor.files", "nil URL control creates no entries")
    l.add("initial.weight.control", "fresh model weight equals fresh local control")
    l.add("initial.offsets.control", "fresh model offsets equal fresh local control")
    for (i, s) in input.steps.enumerated() {
        let p = "step.\(i)"
        if s.learning != nil { l.add(p + ".learning", "requested public learning flag is installed") }
        if s.payload.normalizedText != nil { l.add(p + ".normalization", "fixed independent normalized text") }
        l.add(p + ".acceptance", "\(s.expectedAccepted)")
        l.add(p + ".weight", s.weightRule == "increase" ? "finite weight strictly increases" : "bit-exact unchanged weight")
        if !s.expectedAccepted { l.add(p + ".offsets.unchanged", "bit-exact unchanged offsets") }
        if let rule = s.statusRule { l.add(p + ".status", rule) }
        if input.mode == "memory" || !s.expectedAccepted { l.add(p + ".files", "all cwd authority membership/bytes/mtime/inodes unchanged") }
        if s.expectedAccepted { l.add(p + ".control.acceptance", "true") }
        l.add(p + ".weight.control", "weight equals fixed equivalent ordered local control")
        l.add(p + ".offsets.control", "offsets equal fixed equivalent ordered local control")
        if s.settleAfter && input.mode == "persistent" {
            l.add(p + ".settle.save", "synchronous save succeeds")
            l.add(p + ".settle.weight", "save preserves weight exactly")
            l.add(p + ".settle.offsets", "save preserves offsets exactly")
        }
    }
    if input.roundTrip {
        l.add("roundtrip.save", "synchronous save succeeds")
        l.add("roundtrip.save.weight", "save preserves weight exactly")
        l.add("roundtrip.save.offsets", "save preserves offsets exactly")
        l.add("roundtrip.reopen.weight", "reopened weight equals pre-save state")
        l.add("roundtrip.reopen.offsets", "reopened offsets equal pre-save state")
        l.add("roundtrip.reopen.control.weight", "reopened weight equals local ordered control")
        l.add("roundtrip.reopen.control.offsets", "reopened offsets equal local ordered control")
        l.add("roundtrip.reload.weight", "reload without external writes preserves weight exactly")
        l.add("roundtrip.reload.offsets", "reload without external writes preserves offsets exactly")
    }
    if input.nilSave {
        l.add("nilSave.files", "nil URL explicit save creates no entries and changes no cwd metadata")
        l.add("nilSave.weight", "nil URL save preserves weight exactly")
        l.add("nilSave.offsets", "nil URL save preserves offsets exactly")
    }
    return l
}
func makeWord(_ payload: Payload) throws -> TypedWord {
    let geometry = LetterGeometry.qwerty
    let points: [KeyPoint?] = try payload.taps.map { item -> KeyPoint? in
        guard let item else { return nil }
        let bytes = Array(item.key.utf8)
        guard bytes.count == 1, bytes[0] >= 97, bytes[0] <= 122,
              let center = geometry.center(bytes[0]) else { throw Failure("fixture key has no public geometry center") }
        return KeyPoint(x: center.x + (try item.dx.value()), y: center.y + (try item.dy.value()))
    }
    return TypedWord(text: payload.text, taps: points)
}
func requireNotBusy(_ model: TouchModel, _ operation: String) throws {
    if model.persistenceResult.rawValue == "busy" { throw Busy(operation: operation) }
}
func compareControl(_ prefix: String, _ model: TouchModel, _ control: TouchModel, _ l: Ledger, _ f: FixtureSet) {
    let a = State(model), b = State(control)
    l.check(prefix + ".weight.control", a.equivalentWeight(b, f.offsetAbsoluteTolerance, f.offsetRelativeTolerance),
            ["primary": number(a.weight), "control": number(b.weight)])
    l.check(prefix + ".offsets.control", a.equivalentOffsets(b, f.offsetAbsoluteTolerance, f.offsetRelativeTolerance),
            ["primary": a.json, "control": b.json])
}
func saveAndCheck(_ model: TouchModel, _ prefix: String, _ l: Ledger) throws {
    let before = State(model)
    let saved = model.save(inBackground: false)
    l.events.append(["operation": prefix, "saveReturn": saved, "status": model.persistenceResult.rawValue])
    try requireNotBusy(model, prefix)
    l.check(prefix + ".save", saved, saved)
    let after = State(model)
    l.check(prefix + ".weight", after.exactWeight(before), ["before": before.json, "after": after.json])
    l.check(prefix + ".offsets", after.exactOffsets(before), ["before": before.json, "after": after.json])
}
func perform(_ input: Instance, dir: URL, fixtures: FixtureSet, ledger: Ledger) throws {
    guard input.mode == "memory" || input.mode == "persistent" else { throw Failure("unsupported mode") }
    let fm = FileManager.default
    try fm.createDirectory(at: dir, withIntermediateDirectories: false)
    let oldCWD = fm.currentDirectoryPath
    guard fm.changeCurrentDirectoryPath(dir.path) else { throw Failure("cannot enter isolated cwd") }
    defer { _ = fm.changeCurrentDirectoryPath(oldCWD) }
    let url = dir.appendingPathComponent("TouchModel.json")
    if input.mode == "persistent" {
        let authority = LearnedDataPersistence.storageURL(for: url).standardizedFileURL
        guard authority.path.hasPrefix(dir.standardizedFileURL.path + "/") else {
            throw Failure("public authority URL escapes isolated directory")
        }
        ledger.events.append(["operation": "authority", "requestedURL": url.path, "authorityURL": authority.path])
    }
    let constructorFiles = try captureFiles(dir)
    let model = TouchModel(url: input.mode == "memory" ? nil : url)
    model.isLearning = true
    ledger.events.append(["operation": "constructor", "status": model.persistenceResult.rawValue, "state": State(model).json])
    try requireNotBusy(model, "constructor")
    if input.mode == "memory" {
        let after = try captureFiles(dir)
        ledger.check("constructor.files", constructorFiles == after, ["before": constructorFiles.json, "after": after.json])
    }
    let preControlFiles = try captureFiles(dir)
    let control = TouchModel(url: nil)
    control.isLearning = true
    ledger.events.append(["operation": "control.constructor", "status": control.persistenceResult.rawValue])
    try requireNotBusy(control, "control.constructor")
    let postControlFiles = try captureFiles(dir)
    ledger.check("control.constructor.files", preControlFiles == postControlFiles, ["before": preControlFiles.json, "after": postControlFiles.json])
    let initial = State(model), initialControl = State(control)
    ledger.check("initial.weight.control", initial.equivalentWeight(initialControl, fixtures.offsetAbsoluteTolerance, fixtures.offsetRelativeTolerance), ["primary": initial.json, "control": initialControl.json])
    ledger.check("initial.offsets.control", initial.equivalentOffsets(initialControl, fixtures.offsetAbsoluteTolerance, fixtures.offsetRelativeTolerance), ["primary": initial.json, "control": initialControl.json])
    for (i, s) in input.steps.enumerated() {
        let p = "step.\(i)"
        if let learning = s.learning {
            model.isLearning = learning
            ledger.check(p + ".learning", model.isLearning == learning, model.isLearning)
        }
        if let normalized = s.payload.normalizedText {
            let actual = TextNormalizer.key(s.payload.text)
            ledger.check(p + ".normalization", actual == normalized, actual)
        }
        let before = State(model)
        // For a rejection after seed, the immediately preceding synchronous save
        // has already settled that seed. Constructor effects precede this baseline.
        let beforeFiles = try captureFiles(dir)
        let accepted = model.learn(try makeWord(s.payload), intended: s.payload.intended, geometry: .qwerty)
        let status = model.persistenceResult.rawValue
        let after = State(model)
        let afterFiles = try captureFiles(dir)
        ledger.events.append(["operation": p + ".learn", "accepted": accepted, "status": status,
                              "expectedActualSamples": s.expectedActualSamples, "before": before.json, "after": after.json,
                              "beforeFiles": beforeFiles.json, "afterFiles": afterFiles.json])
        // Busy is never classified as a pass or an expected invalid rejection.
        try requireNotBusy(model, p + ".learn")
        ledger.check(p + ".acceptance", accepted == s.expectedAccepted, accepted)
        ledger.check(p + ".weight", s.weightRule == "increase" ? after.weight.isFinite && before.weight.isFinite && after.weight > before.weight : after.exactWeight(before),
                     ["before": number(before.weight), "after": number(after.weight)])
        if !s.expectedAccepted { ledger.check(p + ".offsets.unchanged", after.exactOffsets(before), ["before": before.json, "after": after.json]) }
        if let rule = s.statusRule { ledger.check(p + ".status", status == rule, status) }
        if input.mode == "memory" || !s.expectedAccepted {
            ledger.check(p + ".files", beforeFiles == afterFiles, ["before": beforeFiles.json, "after": afterFiles.json])
        }
        if s.expectedAccepted {
            guard let fixedControl = s.control else { throw Failure("accepted step missing fixed control") }
            let controlBeforeFiles = try captureFiles(dir)
            let acceptedControl = control.learn(try makeWord(fixedControl), intended: fixedControl.intended, geometry: .qwerty)
            let controlAfterFiles = try captureFiles(dir)
            ledger.events.append(["operation": p + ".control.learn", "accepted": acceptedControl, "status": control.persistenceResult.rawValue,
                                  "state": State(control).json, "filesUnchanged": controlBeforeFiles == controlAfterFiles])
            try requireNotBusy(control, p + ".control.learn")
            ledger.check(p + ".control.acceptance", acceptedControl, acceptedControl)
            // Changes caused by a nil-URL control are an explicit error even in
            // persistent instances; they cannot disappear inside a later baseline.
            if controlBeforeFiles != controlAfterFiles {
                throw Failure("nil URL control learn changed isolated filesystem")
            }
        }
        compareControl(p, model, control, ledger, fixtures)
        if s.settleAfter && input.mode == "persistent" { try saveAndCheck(model, p + ".settle", ledger) }
    }
    if input.roundTrip {
        let before = State(model)
        let saved = model.save(inBackground: false)
        ledger.events.append(["operation": "roundtrip.save", "saveReturn": saved, "status": model.persistenceResult.rawValue])
        try requireNotBusy(model, "roundtrip.save")
        ledger.check("roundtrip.save", saved, saved)
        let afterSave = State(model)
        ledger.check("roundtrip.save.weight", afterSave.exactWeight(before), afterSave.json)
        ledger.check("roundtrip.save.offsets", afterSave.exactOffsets(before), afterSave.json)
        // The first model stays alive: this checks public persistence/reopen
        // compatibility, and makes no coordinator lifetime or epoch claim.
        let reopened = TouchModel(url: url)
        ledger.events.append(["operation": "roundtrip.reopen", "status": reopened.persistenceResult.rawValue, "state": State(reopened).json])
        try requireNotBusy(reopened, "roundtrip.reopen")
        let actual = State(reopened), expectedControl = State(control)
        ledger.check("roundtrip.reopen.weight", actual.equivalentWeight(before, fixtures.offsetAbsoluteTolerance, fixtures.offsetRelativeTolerance), ["actual": actual.json, "before": before.json])
        ledger.check("roundtrip.reopen.offsets", actual.equivalentOffsets(before, fixtures.offsetAbsoluteTolerance, fixtures.offsetRelativeTolerance), ["actual": actual.json, "before": before.json])
        ledger.check("roundtrip.reopen.control.weight", actual.equivalentWeight(expectedControl, fixtures.offsetAbsoluteTolerance, fixtures.offsetRelativeTolerance), ["actual": actual.json, "control": expectedControl.json])
        ledger.check("roundtrip.reopen.control.offsets", actual.equivalentOffsets(expectedControl, fixtures.offsetAbsoluteTolerance, fixtures.offsetRelativeTolerance), ["actual": actual.json, "control": expectedControl.json])
        let reloaded = reopened.reloadIfChangedOnDisk()
        ledger.events.append(["operation": "roundtrip.reload", "reloadReturn": reloaded, "status": reopened.persistenceResult.rawValue, "state": State(reopened).json])
        try requireNotBusy(reopened, "roundtrip.reload")
        ledger.check("roundtrip.reload.weight", State(reopened).exactWeight(actual), State(reopened).json)
        ledger.check("roundtrip.reload.offsets", State(reopened).exactOffsets(actual), State(reopened).json)
    }
    if input.nilSave {
        let before = State(model), files = try captureFiles(dir)
        let saved = model.save(inBackground: false)
        ledger.events.append(["operation": "nilSave", "saveReturn": saved, "status": model.persistenceResult.rawValue])
        let after = State(model), afterFiles = try captureFiles(dir)
        try requireNotBusy(model, "nilSave")
        ledger.check("nilSave.files", files == afterFiles, ["before": files.json, "after": afterFiles.json])
        ledger.check("nilSave.weight", after.exactWeight(before), ["before": before.json, "after": after.json])
        ledger.check("nilSave.offsets", after.exactOffsets(before), ["before": before.json, "after": after.json])
    }
}
func writeJSON(_ value: Any, _ url: URL) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: url, options: .atomic)
}
func validate(_ f: FixtureSet) throws {
    guard f.schemaVersion == 1, f.busyRetryCount == 0,
          f.uniqueFamilyCount == f.families.count,
          f.instanceCount == f.families.reduce(0, { $0 + $1.instances.count }),
          f.plannedCheckCount == f.families.reduce(0, { total, family in total + family.instances.reduce(0, { $0 + $1.plannedCheckCount }) }),
          f.offsetAbsoluteTolerance == 1e-12, f.offsetRelativeTolerance == 1e-12 else { throw Failure("invalid fixed fixture header") }
    var ids = Set<String>()
    for family in f.families {
        guard !family.instances.isEmpty, ids.insert(family.id).inserted,
              family.id.range(of: "^[a-z0-9_]+$", options: .regularExpression) != nil else { throw Failure("invalid family identity") }
        var instanceIDs = Set<String>()
        for item in family.instances {
            guard instanceIDs.insert(item.id).inserted,
                  item.id == item.mode, ["memory", "persistent"].contains(item.mode),
                  !item.steps.isEmpty, !item.roundTrip || item.mode == "persistent",
                  !item.nilSave || item.mode == "memory",
                  plan(item).counts["check"] == item.plannedCheckCount else { throw Failure("invalid instance") }
            for s in item.steps {
                guard s.weightRule == (s.expectedAccepted ? "increase" : "unchanged"),
                      (s.control != nil) == s.expectedAccepted,
                      s.expectedActualSamples >= 0 else { throw Failure("invalid fixed step") }
            }
        }
    }
}
func main() throws -> Int32 {
    let args = CommandLine.arguments
    guard args.count == 3 else { throw Failure("usage: runner fixtures.json /absolute/fresh-output-dir") }
    let fixtureURL = URL(fileURLWithPath: args[1]).standardizedFileURL
    let f = try JSONDecoder().decode(FixtureSet.self, from: Data(contentsOf: fixtureURL))
    try validate(f)
    guard args[2].hasPrefix("/") else { throw Failure("output directory must be absolute") }
    let output = URL(fileURLWithPath: args[2], isDirectory: true).standardizedFileURL
    let fm = FileManager.default
    guard !fm.fileExists(atPath: output.path) else { throw Failure("output directory must not already exist") }
    try fm.createDirectory(at: output, withIntermediateDirectories: false)
    let work = output.appendingPathComponent("isolated-work", isDirectory: true)
    try fm.createDirectory(at: work, withIntermediateDirectories: false)
    var totals = ["check": 0, "pass": 0, "fail": 0, "unavailable": 0, "error": 0]
    var families: [[String: Any]] = []
    var publicationErrors: [String] = []
    for family in f.families {
        var instances: [[String: Any]] = []
        var familyCounts = ["check": 0, "pass": 0, "fail": 0, "unavailable": 0, "error": 0]
        for input in family.instances {
            let ledger = plan(input)
            let dir = work.appendingPathComponent(family.id + "_" + input.id, isDirectory: true)
            do {
                try perform(input, dir: dir, fixtures: f, ledger: ledger)
                ledger.finishPending("error", "runner left a planned check unresolved")
            } catch let busy as Busy {
                ledger.events.append(["operation": busy.operation, "classification": "unavailable", "reason": "explicit busy; fixed retry count zero"])
                ledger.finishPending("unavailable", "dependency unavailable after explicit busy at " + busy.operation)
            } catch {
                ledger.events.append(["classification": "error", "reason": String(describing: error)])
                ledger.finishPending("error", String(describing: error))
            }
            for (key, value) in ledger.counts { familyCounts[key, default: 0] += value }
            instances.append(["id": input.id, "mode": input.mode, "result": ledger.json])
        }
        let item: [String: Any] = ["familyID": family.id, "counts": familyCounts, "instances": instances]
        families.append(item)
        for (key, value) in familyCounts { totals[key, default: 0] += value }
        do { try writeJSON(item, output.appendingPathComponent(family.id + ".json")) }
        catch { publicationErrors.append(family.id + ": " + String(describing: error)) }
    }
    let complete = totals["fail", default: 0] == 0 && totals["error", default: 0] == 0 && totals["unavailable", default: 0] == 0 && publicationErrors.isEmpty
    let summary: [String: Any] = ["schemaVersion": 1, "uniqueFamilies": f.families.count,
        "modeInstances": f.instanceCount, "plannedCheckCount": f.plannedCheckCount, "counts": totals, "completePass": complete,
        "busyRetryCount": 0, "publicationErrors": publicationErrors, "families": families]
    try writeJSON(summary, output.appendingPathComponent("results.json"))
    print("families=\(f.families.count) instances=\(f.instanceCount) checks=\(totals["check", default: 0]) pass=\(totals["pass", default: 0]) fail=\(totals["fail", default: 0]) unavailable=\(totals["unavailable", default: 0]) error=\(totals["error", default: 0])")
    if totals["fail", default: 0] > 0 { return 1 }
    return complete ? 0 : 2
}
do { exit(try main()) }
catch { FileHandle.standardError.write(Data("runner setup/output error: \(error)\n".utf8)); exit(2) }
