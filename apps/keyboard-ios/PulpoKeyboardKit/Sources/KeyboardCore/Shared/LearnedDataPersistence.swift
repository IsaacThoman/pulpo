import Foundation
import SQLite3
#if canImport(Darwin)
import Darwin
#endif

/// `ok` is confirmed, not an enqueued write. An uncertain operation may have
/// committed. A cleanup failure means reset committed but legacy removal failed.
public enum LearningPersistenceResult: String, Error, Sendable {
  case ok, busy, capacity, invalid, io, uncertain, cleanup
}

enum LearningKind: Int, Sendable { case dictionary, touch }
struct TouchSample: Sendable { let slot: Int; let dx: Double; let dy: Double }
enum LearningMutation: Sendable {
  case learn(String, String?, Bool, Double)
  case pin(String, Double)
  case touch([TouchSample])

  var key: String? {
    switch self {
    case let .learn(word, _, _, _), let .pin(word, _): TextNormalizer.key(word)
    case .touch: nil
    }
  }
  func valid(for kind: LearningKind) -> Bool {
    func validWord(_ word: String) -> Bool {
      !word.isEmpty && word.count <= 40 && word.utf8.count <= 256 &&
        !TextNormalizer.key(word).isEmpty && TextNormalizer.key(word).utf8.count <= 256
    }
    switch self {
    case let .learn(word, history, _, time):
      return kind == .dictionary && validWord(word) && time.isFinite &&
        (history == nil || history!.lowercased().utf8.count <= 256)
    case let .pin(word, time): return kind == .dictionary && validWord(word) && time.isFinite
    case let .touch(samples):
      return kind == .touch && !samples.isEmpty && samples.count <= 40 && samples.allSatisfy {
        (0..<26).contains($0.slot) && $0.dx.isFinite && $0.dy.isFinite
      }
    }
  }
}

enum LearningPayload: Sendable {
  case dictionary(PersonalDictionary.Snapshot)
  case touch(TouchModel.Snapshot)

  static func empty(_ kind: LearningKind) -> Self {
    kind == .dictionary ? .dictionary(.init()) : .touch(.init(keys: Array(repeating: [0, 0, 0], count: 26)))
  }
  func applying(_ operations: [LearningMutation]) throws -> Self {
    switch self {
    case let .dictionary(snapshot): .dictionary(try PersonalDictionary.applying(operations, to: snapshot))
    case let .touch(snapshot): .touch(TouchModel.applying(operations, to: snapshot))
    }
  }
  func encoded() throws -> Data {
    let data: Data
    switch self {
    case let .dictionary(value): data = try JSONEncoder().encode(value)
    case let .touch(value): data = try JSONEncoder().encode(value)
    }
    guard data.count <= LearningSQL.maximumBytes else { throw LearningPersistenceResult.capacity }
    return data
  }
  static func decode(_ data: Data, kind: LearningKind, legacy: Bool = false) throws -> Self {
    guard data.count <= LearningSQL.maximumBytes else { throw LearningPersistenceResult.capacity }
    switch kind {
    case .dictionary:
      var value = try JSONDecoder().decode(PersonalDictionary.Snapshot.self, from: data)
      guard value.version == 1, [1, 2, 4].contains(value.pairEncoding),
            legacy || (value.words.count <= PersonalDictionary.maximumWords && value.pairs.count <= PersonalDictionary.maximumPairs) else { throw LearningPersistenceResult.invalid }
      var total = 0
      for (word, entry) in value.words {
        guard LearningMutation.pin(word, entry.lastUsed).valid(for: .dictionary), entry.count > 0,
              !total.addingReportingOverflow(entry.count).overflow else { throw LearningPersistenceResult.invalid }
        total += entry.count
      }
      var historyCounts: [String: Int] = [:]
      for (pair, count) in value.pairs {
        guard count > 0, let parts = PersonalDictionary.splitPair(pair, encoding: value.pairEncoding),
              !parts.history.isEmpty, parts.history.utf8.count <= 256,
              LearningMutation.pin(parts.target, 0).valid(for: .dictionary) else { throw LearningPersistenceResult.invalid }
        let previous = historyCounts[parts.history, default: 0]
        guard !previous.addingReportingOverflow(count).overflow else { throw LearningPersistenceResult.invalid }
        historyCounts[parts.history] = previous + count
      }
      // Existing explicit block preferences have only the payload byte bound.
      // Do not discard them merely because new admissions use smaller strings.
      if value.pairEncoding != 4 {
        value.pairs = try PersonalDictionary.canonicalPairs(value.pairs, encoding: value.pairEncoding)
        value.pairEncoding = 4
      }
      return .dictionary(legacy ? PersonalDictionary.pruningLegacy(value) : value)
    case .touch:
      let value = try JSONDecoder().decode(TouchModel.Snapshot.self, from: data)
      guard value.version == 1, value.keys.count == 26, value.keys.allSatisfy({ values in
        values.count == 3 && values.allSatisfy(\.isFinite) && values[2] >= 0 && values[2] <= 300 &&
          abs(values[0]) <= values[2] * 0.85 + 1e-9 && abs(values[1]) <= values[2] * 0.85 + 1e-9
      }) else { throw LearningPersistenceResult.invalid }
      return .touch(value)
    }
  }
}

struct LearningOutcome { let result: LearningPersistenceResult; var payload: LearningPayload? = nil }

/// One authoritative database contains both product stores. The original JSON
/// paths are migration inputs only; a marker prevents reimport after data loss.
public enum LearnedDataPersistence {
  public static func storageURL(for url: URL) -> URL { LearningDomain(url: url).database }

  public static func clear(dictionaryURL: URL?, touchURL: URL?) -> LearningPersistenceResult {
    guard let dictionaryURL, let touchURL else { return .invalid }
    let domain = LearningDomain(url: dictionaryURL)
    guard domain.canonical, dictionaryURL.lastPathComponent == "PersonalDictionary.json",
          touchURL.lastPathComponent == "TouchModel.json",
          domain.database == LearningDomain(url: touchURL).database else { return .invalid }
    guard let coordinator = LearningCoordinator.find(domain) else { return .busy }
    return coordinator.clear(kinds: [.dictionary, .touch]).result
  }
}

private struct LearningDomain: Sendable {
  let database: URL
  let dictionary: URL?
  let touch: URL?
  let canonical: Bool
  init(url: URL) {
    let parent = url.deletingLastPathComponent().standardizedFileURL.resolvingSymlinksInPath()
    canonical = ["PersonalDictionary.json", "TouchModel.json"].contains(url.lastPathComponent)
    let authority = canonical ? "PersonalDictionary.json" : url.lastPathComponent
    database = parent.appendingPathComponent(authority + ".learning-v2.sqlite")
    dictionary = canonical ? parent.appendingPathComponent("PersonalDictionary.json") : nil
    touch = canonical ? parent.appendingPathComponent("TouchModel.json") : nil
  }
  var marker: URL { URL(fileURLWithPath: database.path + ".initialized") }
  var lock: URL { URL(fileURLWithPath: database.path + ".lock") }
}

/// Models retain their projection. The coordinator owns all replayable records;
/// background jobs capture no snapshots and never mutate model indexes.
final class LearningSession {
  private var coordinator: LearningCoordinator?
  private let url: URL
  fileprivate let owner = UUID()
  fileprivate let kind: LearningKind
  fileprivate var epoch: String?
  fileprivate var revision: Int64 = -1
  fileprivate var seen: Set<Int64> = []
  init(url: URL, kind: LearningKind) {
    self.kind = kind; self.url = url
    coordinator = LearningCoordinator.find(LearningDomain(url: url), standalone: url, kind: kind)
  }
  private func resolve() -> LearningCoordinator? {
    if coordinator == nil { coordinator = LearningCoordinator.find(LearningDomain(url: url), standalone: url, kind: kind) }
    return coordinator
  }
  func admit(_ mutation: LearningMutation) -> LearningOutcome {
    resolve()?.admit(mutation, session: self) ?? .init(result: .busy)
  }
  func observe() -> LearningOutcome { resolve()?.observe(session: self) ?? .init(result: .busy) }
  func save() -> LearningOutcome { resolve()?.save(session: self) ?? .init(result: .busy) }
  func saveInBackground() { resolve()?.scheduleSave() }
  func clear() -> LearningOutcome {
    guard let coordinator = resolve() else { return .init(result: .busy) }
    return coordinator.clear(kinds: [kind])
  }
  func forget(_ word: String) -> LearningOutcome {
    resolve()?.forget(word, session: self) ?? .init(result: .busy)
  }
  var hasUnsavedChanges: Bool { coordinator?.hasPending(owner: owner) ?? true }
}

private final class LearningCoordinator: @unchecked Sendable {
  private final class Weak { weak var value: LearningCoordinator?; init(_ value: LearningCoordinator) { self.value = value } }
  private static let registryLock = NSLock()
  // Fixed stripes also share local exclusion for uncached slotless readers at
  // registry capacity, without an unbounded path-to-lock cache. Collisions only
  // cause explicit nonblocking busy backpressure between unrelated domains.
  private static let transactionLocks = (0..<32).map { _ in NSLock() }
  nonisolated(unsafe) private static var registry: [String: Weak] = [:]
  static func find(_ domain: LearningDomain, standalone: URL? = nil, kind: LearningKind? = nil) -> LearningCoordinator? {
    guard registryLock.try() else { return nil }
    defer { registryLock.unlock() }
    registry = registry.filter { $0.value.value != nil }
    if let existing = registry[domain.database.path]?.value { return existing }
    let value = LearningCoordinator(domain, standalone: standalone, kind: kind, allowsAdmission: registry.count < 32)
    // Slotless reset/read may use an ephemeral coordinator at registry capacity.
    if registry.count < 32 { registry[domain.database.path] = Weak(value) }
    return value
  }

  private struct Record {
    let sequence: Int64
    let owner: UUID
    let kind: LearningKind
    let epoch: String
    let mutation: LearningMutation
    var eligible: Bool
  }
  private struct Stored {
    let epoch: String
    let revision: Int64
    let payload: LearningPayload
    let arithmeticRisk: Bool
    init(epoch: String, revision: Int64, payload: LearningPayload) {
      self.epoch = epoch; self.revision = revision; self.payload = payload
      if case let .dictionary(snapshot) = payload {
        let words = snapshot.words.values.reduce(0) { $0 + $1.count }
        var pairs = 0; var overflow = false
        for count in snapshot.pairs.values {
          let sum = pairs.addingReportingOverflow(count)
          if sum.overflow { overflow = true; break }
          pairs = sum.partialValue
        }
        arithmeticRisk = overflow || words > Int.max - 1024 || pairs > Int.max - 1024
      } else { arithmeticRisk = false }
    }
  }
  private let domain: LearningDomain
  private let standalone: URL?
  private let standaloneKind: LearningKind?
  private let allowsAdmission: Bool
  private var dataVersion: Int64?
  private var authorityID: String?
  private let mutex: NSLock
  private let schedulerLock = NSLock()
  private var scheduled = false
  private var again = false
  private let queue = DispatchQueue(label: "com.isaacthoman.pulpo.keyboard.learning", qos: .utility)
  private var sql: LearningSQL?
  private var identity: PersonalDictionary.FileStamp?
  private var slot: Int?
  private var slotFD: Int32 = -1
  private let incarnation = UUID().uuidString
  private var sequence: Int64 = 0
  private var records: [Record] = []
  private var acknowledgements: [Int64: LearningKind] = [:]
  private var cache: [LearningKind: Stored] = [:]

  private init(_ domain: LearningDomain, standalone: URL?, kind: LearningKind?, allowsAdmission: Bool) {
    self.domain = domain; self.standalone = standalone; standaloneKind = kind; self.allowsAdmission = allowsAdmission
    mutex = Self.transactionLocks[Int(domain.database.path.hashValue.magnitude % UInt(Self.transactionLocks.count))]
  }
  deinit { if slotFD >= 0 { close(slotFD) } }

  private func protectedFile(_ url: URL, exclusive: Bool = false) throws -> Int32 {
    let fd = open(url.path, O_RDWR | O_CREAT | O_NOFOLLOW | (exclusive ? O_EXCL : 0), S_IRUSR | S_IWUSR)
    guard fd >= 0 else { throw LearningPersistenceResult.io }
    guard fchmod(fd, S_IRUSR | S_IWUSR) == 0 else { close(fd); throw LearningPersistenceResult.io }
    #if os(iOS)
    do { try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path) }
    catch { close(fd); throw LearningPersistenceResult.io }
    #endif
    return fd
  }
  private func noSymlink(_ url: URL) throws {
    var info = stat()
    if lstat(url.path, &info) == 0 {
      guard (info.st_mode & S_IFMT) == S_IFREG else { throw LearningPersistenceResult.invalid }
    } else if errno != ENOENT { throw LearningPersistenceResult.io }
  }
  private func acquireSlot() throws {
    if slot != nil { return }
    try FileManager.default.createDirectory(at: domain.database.deletingLastPathComponent(), withIntermediateDirectories: true)
    for index in 0..<8 {
      let fd = try protectedFile(URL(fileURLWithPath: domain.database.path + ".writer.\(index)"))
      if flock(fd, LOCK_EX | LOCK_NB) == 0 { slot = index; slotFD = fd; return }
      let error = errno; close(fd)
      if error != EWOULDBLOCK && error != EAGAIN { throw LearningPersistenceResult.io }
    }
    throw LearningPersistenceResult.capacity
  }
  private func global<T>(_ body: (LearningSQL) throws -> T) throws -> T {
    try FileManager.default.createDirectory(at: domain.database.deletingLastPathComponent(), withIntermediateDirectories: true)
    let fd = try protectedFile(domain.lock)
    defer { close(fd) }
    guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
      throw errno == EWOULDBLOCK || errno == EAGAIN ? LearningPersistenceResult.busy : .io
    }
    let database = try openDatabase()
    let version = try database.rows("PRAGMA data_version")[0][0].integer
    if dataVersion != version {
      try validateRegistrar(database)
      dataVersion = version
    }
    return try body(database)
  }
  private func legacy(_ url: URL?, kind: LearningKind) throws -> LearningPayload {
    guard let url else { return .empty(kind) }
    try noSymlink(url)
    let handle: FileHandle
    do { handle = try FileHandle(forReadingFrom: url) }
    catch let error as CocoaError where error.code == .fileReadNoSuchFile || error.code == .fileNoSuchFile { return .empty(kind) }
    defer { try? handle.close() }
    var data = Data()
    while data.count <= LearningSQL.maximumBytes {
      let chunk = try handle.read(upToCount: min(65536, LearningSQL.maximumBytes + 1 - data.count)) ?? Data()
      if chunk.isEmpty { return try LearningPayload.decode(data, kind: kind, legacy: true) }
      data.append(chunk)
    }
    throw LearningPersistenceResult.capacity
  }
  private func openDatabase() throws -> LearningSQL {
    try noSymlink(domain.database); try noSymlink(domain.marker)
    if let sql, sqlite3_get_autocommit(sql.handle) == 0 {
      try? sql.exec("ROLLBACK")
      if sqlite3_get_autocommit(sql.handle) == 0 {
        sql.dispose(); self.sql = nil; identity = nil; cache = [:]; dataVersion = nil
      }
    }
    if let sql {
      guard let current = PersonalDictionary.FileStamp(url: domain.database), let identity,
            current.device == identity.device, current.inode == identity.inode,
            FileManager.default.fileExists(atPath: domain.marker.path) else { throw LearningPersistenceResult.invalid }
      return sql
    }
    let hasDB = FileManager.default.fileExists(atPath: domain.database.path)
    let hasMarker = FileManager.default.fileExists(atPath: domain.marker.path)
    guard hasDB == hasMarker else { throw LearningPersistenceResult.invalid }
    var imports: [LearningKind: LearningPayload] = [:]
    if !hasDB {
      imports[.dictionary] = try legacy(domain.canonical ? domain.dictionary : (standaloneKind == .dictionary ? standalone : nil), kind: .dictionary)
      imports[.touch] = try legacy(domain.canonical ? domain.touch : (standaloneKind == .touch ? standalone : nil), kind: .touch)
      let marker = try protectedFile(domain.marker, exclusive: true)
      guard fsync(marker) == 0 else { close(marker); throw LearningPersistenceResult.io }
      close(marker)
    }
    let connection = try LearningSQL(url: domain.database, create: !hasDB)
    if !hasDB {
      let creation = UUID().uuidString
      let outcome = transaction(connection, body: {
        try connection.exec("CREATE TABLE meta(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, identity TEXT NOT NULL)")
        try connection.exec("CREATE TABLE stores(kind INTEGER PRIMARY KEY CHECK(kind IN(0,1)), epoch TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=0), change TEXT NOT NULL, payload BLOB NOT NULL)")
        try connection.exec("CREATE TABLE slots(slot INTEGER PRIMARY KEY CHECK(slot>=0 AND slot<8), incarnation TEXT NOT NULL, UNIQUE(slot,incarnation))")
        try connection.exec("CREATE TABLE tokens(slot INTEGER NOT NULL, incarnation TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence>0), kind INTEGER NOT NULL CHECK(kind IN(0,1)), epoch TEXT NOT NULL, key TEXT, status INTEGER NOT NULL CHECK(status IN(0,1,2)), PRIMARY KEY(slot,incarnation,sequence), FOREIGN KEY(slot,incarnation) REFERENCES slots(slot,incarnation) ON DELETE CASCADE, CHECK((kind=1 AND key IS NULL) OR (kind=0 AND length(CAST(key AS BLOB)) BETWEEN 1 AND 256)))")
        try connection.execute("INSERT INTO meta VALUES(1,2,?)", [.text(creation)])
        for kind in [LearningKind.dictionary, .touch] {
          try connection.execute("INSERT INTO stores VALUES(?,?,0,?,?)", [.int(Int64(kind.rawValue)), .text(UUID().uuidString), .text(creation), .data(try imports[kind]!.encoded())])
        }
      }, confirm: { try connection.rows("SELECT identity FROM meta WHERE id=1").first?.first?.string == creation })
      guard outcome == .ok else { throw outcome }
    }
    let meta = try connection.rows("SELECT version,identity FROM meta WHERE id=1")
    guard meta.count == 1, meta[0][0].integer == 2, UUID(uuidString: meta[0][1].string ?? "") != nil else { throw LearningPersistenceResult.invalid }
    for kind in [LearningKind.dictionary, .touch] { _ = try stored(kind, connection, useCache: false) }
    authorityID = meta[0][1].string
    self.sql = connection; identity = PersonalDictionary.FileStamp(url: domain.database)
    return connection
  }

  /// An error after a real COMMIT is resolved from durable identities under the
  /// same global lock. A still-uncertain admission is never eligible for replay.
  private func transaction(_ db: LearningSQL, body: () throws -> Void, confirm: () throws -> Bool) -> LearningPersistenceResult {
    do { try db.exec("BEGIN IMMEDIATE") } catch { return failure(error) }
    do { try body() } catch {
      try? db.exec("ROLLBACK")
      return sqlite3_get_autocommit(db.handle) == 0 ? .uncertain : failure(error)
    }
    do { try db.exec("COMMIT"); return .ok } catch {
      if sqlite3_get_autocommit(db.handle) == 0 { try? db.exec("ROLLBACK") }
      guard sqlite3_get_autocommit(db.handle) != 0 else { return .uncertain }
      do {
        try db.exec("BEGIN IMMEDIATE")
        let committed = try confirm()
        try db.exec("ROLLBACK")
        return committed ? .ok : failure(error)
      } catch { try? db.exec("ROLLBACK"); return .uncertain }
    }
  }
  private func failure(_ error: Error) -> LearningPersistenceResult {
    if let error = error as? LearningPersistenceResult { return error }
    return error is DecodingError ? .invalid : .io
  }
  private func stored(_ kind: LearningKind, _ db: LearningSQL, useCache: Bool = true) throws -> Stored {
    let rows = try db.rows("SELECT epoch,revision FROM stores WHERE kind=?", [.int(Int64(kind.rawValue))])
    guard rows.count == 1, let epoch = rows[0][0].string, UUID(uuidString: epoch) != nil,
          let revision = rows[0][1].integer, revision >= 0 else { throw LearningPersistenceResult.invalid }
    if useCache, let value = cache[kind], value.epoch == epoch, value.revision == revision { return value }
    let payloadRows = try db.rows("SELECT payload FROM stores WHERE kind=?", [.int(Int64(kind.rawValue))])
    guard let data = payloadRows.first?.first?.data else { throw LearningPersistenceResult.invalid }
    let value = Stored(epoch: epoch, revision: revision, payload: try .decode(data, kind: kind))
    cache[kind] = value
    return value
  }
  private func validateRegistrar(_ db: LearningSQL) throws {
    let meta = try db.rows("SELECT version,identity FROM meta")
    guard meta.count == 1, meta[0][0].integer == 2, meta[0][1].string == authorityID else { throw LearningPersistenceResult.invalid }
    let slots = try db.rows("SELECT slot,incarnation FROM slots")
    guard slots.count <= 8 else { throw LearningPersistenceResult.invalid }
    for row in slots {
      guard let index = row[0].integer, (0..<8).contains(index), UUID(uuidString: row[1].string ?? "") != nil else { throw LearningPersistenceResult.invalid }
    }
    let storeCount = try db.rows("SELECT count(*) FROM stores")[0][0].integer
    guard storeCount == 2 else { throw LearningPersistenceResult.invalid }
    let epochs = try [LearningKind.dictionary, .touch].map { try stored($0, db, useCache: false) }
    let rows = try db.rows("SELECT t.slot,t.incarnation,t.sequence,t.kind,t.epoch,t.key,t.status,s.incarnation FROM tokens t LEFT JOIN slots s ON s.slot=t.slot")
    guard rows.count <= 4096 else { throw LearningPersistenceResult.invalid }
    var counts: [String: Int] = [:]
    for row in rows {
      guard let slot = row[0].integer, (0..<8).contains(slot), let incarnation = row[1].string,
            UUID(uuidString: incarnation) != nil, row[7].string == incarnation,
            let number = row[2].integer, number > 0, let kind = row[3].integer, (0...1).contains(kind),
            let epoch = row[4].string, UUID(uuidString: epoch) != nil,
            let status = row[6].integer, (0...2).contains(status) else { throw LearningPersistenceResult.invalid }
      if kind == 0 {
        // This is the writer's opaque normalization result, not another input
        // to the normalizer. Lowercasing before compatibility decomposition can
        // legitimately produce capitals, so normalization is not idempotent.
        guard let key = row[5].string, !key.isEmpty, key.utf8.count <= 256 else { throw LearningPersistenceResult.invalid }
      } else { guard case .null = row[5] else { throw LearningPersistenceResult.invalid } }
      if status == 0 && epoch != epochs[Int(kind)].epoch { throw LearningPersistenceResult.invalid }
      let group = "\(slot):\(kind)"
      counts[group, default: 0] += 1
      guard counts[group]! <= 256 else { throw LearningPersistenceResult.invalid }
    }
  }
  private func claim(_ db: LearningSQL) throws {
    guard let slot else { throw LearningPersistenceResult.invalid }
    let old = try db.rows("SELECT incarnation FROM slots WHERE slot=?", [.int(Int64(slot))]).first?.first?.string
    if old != incarnation {
      // Lifetime flock proves that no live old incarnation can replay these rows.
      try db.execute("DELETE FROM slots WHERE slot=?", [.int(Int64(slot))])
      try db.execute("INSERT INTO slots VALUES(?,?)", [.int(Int64(slot)), .text(incarnation)])
    }
  }
  private func token(_ sequence: Int64, _ db: LearningSQL) throws -> [LearningSQL.Value]? {
    guard let slot else { return nil }
    return try db.rows("SELECT kind,epoch,status FROM tokens WHERE slot=? AND incarnation=? AND sequence=?", [.int(Int64(slot)), .text(incarnation), .int(sequence)]).first
  }
  private func synchronize(_ db: LearningSQL) throws {
    var survivors: [Record] = []
    for record in records {
      if !record.eligible {
        if let slot { try db.execute("DELETE FROM tokens WHERE slot=? AND incarnation=? AND sequence=?", [.int(Int64(slot)), .text(incarnation), .int(record.sequence)]) }
        // Failed/uncertain admission was never taught and can never become valid.
        acknowledgements[record.sequence] = record.kind
        continue
      }
      guard let row = try token(record.sequence, db), row[0].integer == Int64(record.kind.rawValue),
            row[1].string == record.epoch, let status = row[2].integer else { throw LearningPersistenceResult.invalid }
      if status == 0 {
        guard try stored(record.kind, db).epoch == record.epoch else { throw LearningPersistenceResult.invalid }
        survivors.append(record)
      } else { acknowledgements[record.sequence] = record.kind }
    }
    records = survivors
    if let slot {
      for sequence in acknowledgements.keys {
        try db.execute("DELETE FROM tokens WHERE slot=? AND incarnation=? AND sequence=?", [.int(Int64(slot)), .text(incarnation), .int(sequence)])
      }
    }
  }
  private func acknowledgementsDeleted(_ db: LearningSQL) throws -> Bool {
    try acknowledgements.keys.allSatisfy { try token($0, db) == nil }
  }
  private func finishAcknowledgements() { acknowledgements = [:] }
  private func own(_ session: LearningSession) -> [Record] { records.filter { $0.owner == session.owner && $0.eligible } }
  private func projection(_ session: LearningSession, stored: Stored, force: Bool = false) throws -> LearningPayload? {
    let pending = own(session)
    guard force || session.epoch != stored.epoch || session.revision != stored.revision || session.seen != Set(pending.map(\.sequence)) else { return nil }
    return try stored.payload.applying(pending.map(\.mutation))
  }
  private func mark(_ session: LearningSession, _ value: Stored) {
    session.epoch = value.epoch; session.revision = value.revision; session.seen = Set(own(session).map(\.sequence))
  }
  private func localCount(_ kind: LearningKind) -> Int { records.filter { $0.kind == kind }.count + acknowledgements.values.filter { $0 == kind }.count }

  func admit(_ mutation: LearningMutation, session: LearningSession) -> LearningOutcome {
    guard mutation.valid(for: session.kind) else { return .init(result: .invalid) }
    guard allowsAdmission else { return .init(result: .capacity) }
    guard mutex.try() else { return .init(result: .busy) }
    defer { mutex.unlock() }
    if localCount(session.kind) >= 256 {
      let result = commitLocked()
      guard result == .ok else { return .init(result: result) }
      let maintenance = observeLocked(session: session, updateView: false)
      guard maintenance.result == .ok else { return maintenance }
    }
    guard localCount(session.kind) < 256, sequence < Int64.max else { return .init(result: .capacity) }
    do {
      try acquireSlot()
      sequence += 1
      let number = sequence
      var before: LearningPayload?
      var value: Stored?
      var reserved = false
      let result = try global { db in
        let result = transaction(db, body: {
          try claim(db); try synchronize(db)
          let current = try stored(session.kind, db)
          value = current
          before = try projection(session, stored: current)
          if current.arithmeticRisk { _ = try current.payload.applying(own(session).map(\.mutation) + [mutation]) }
          records.append(Record(sequence: number, owner: session.owner, kind: session.kind, epoch: current.epoch, mutation: mutation, eligible: false))
          reserved = true
          let count = try db.rows("SELECT count(*) FROM tokens WHERE slot=? AND kind=?", [.int(Int64(slot!)), .int(Int64(session.kind.rawValue))])[0][0].integer!
          guard count < 256 else { throw LearningPersistenceResult.capacity }
          try db.execute("INSERT INTO tokens VALUES(?,?,?,?,?,?,0)", [.int(Int64(slot!)), .text(incarnation), .int(number), .int(Int64(session.kind.rawValue)), .text(current.epoch), mutation.key.map(LearningSQL.Value.text) ?? .null])
        }, confirm: { try token(number, db)?[2].integer == 0 })
        if result == .ok {
          finishAcknowledgements()
          if let index = records.firstIndex(where: { $0.sequence == number }) { records[index].eligible = true }
        } else if result != .uncertain { records.removeAll { $0.sequence == number } }
        return result
      }
      if result == .ok, let value { mark(session, value) }
      if result == .uncertain && !reserved { return .init(result: .uncertain) }
      return .init(result: result, payload: result == .ok ? before : nil)
    } catch { return .init(result: failure(error)) }
  }

  func observe(session: LearningSession) -> LearningOutcome {
    guard mutex.try() else { return .init(result: .busy) }
    defer { mutex.unlock() }
    return observeLocked(session: session)
  }
  private func observeLocked(session: LearningSession, updateView: Bool = true) -> LearningOutcome {
    do {
      var value: Stored?; var payload: LearningPayload?
      let result = try global { db in
        let outcome = transaction(db, body: {
          try synchronize(db)
          value = try stored(session.kind, db)
          if updateView { payload = try projection(session, stored: value!) }
        }, confirm: { try acknowledgementsDeleted(db) })
        if outcome == .ok { finishAcknowledgements() }
        return outcome
      }
      if result == .ok, updateView, let value { mark(session, value) }
      return .init(result: result, payload: result == .ok ? payload : nil)
    } catch { return .init(result: failure(error)) }
  }
  private func put(_ value: LearningPayload, kind: LearningKind, epoch: String, revision: Int64, change: String, db: LearningSQL) throws -> Stored {
    guard revision < Int64.max else { throw LearningPersistenceResult.capacity }
    let data = try value.encoded()
    // The base was fully validated on read; bounded validated operations preserve
    // its invariants (including checked additions/pruning). Encoding enforces the
    // final byte cap. Re-decoding our own 20,000 pairs here would block a capacity
    // flush on the input thread without adding an independent validation boundary.
    try db.execute("UPDATE stores SET epoch=?,revision=?,change=?,payload=? WHERE kind=?", [.text(epoch), .int(revision + 1), .text(change), .data(data), .int(Int64(kind.rawValue))])
    return Stored(epoch: epoch, revision: revision + 1, payload: value)
  }
  private func commitLocked() -> LearningPersistenceResult {
    do {
      return try global { db in
        var written: [LearningKind: Stored] = [:]
        var applied: [Record] = []
        let outcome = transaction(db, body: {
          try synchronize(db)
          applied = records.filter(\.eligible)
          for kind in [LearningKind.dictionary, .touch] {
            let base = try stored(kind, db)
            let operations = applied.filter { $0.kind == kind }
            guard !operations.isEmpty else { continue }
            let next = try base.payload.applying(operations.map(\.mutation))
            written[kind] = try put(next, kind: kind, epoch: base.epoch, revision: base.revision, change: UUID().uuidString, db: db)
          }
          for record in applied {
            try db.execute("UPDATE tokens SET status=1 WHERE slot=? AND incarnation=? AND sequence=? AND status=0", [.int(Int64(slot!)), .text(incarnation), .int(record.sequence)])
          }
        }, confirm: {
          try acknowledgementsDeleted(db) && applied.allSatisfy { try token($0.sequence, db)?[2].integer == 1 }
        })
        if outcome == .ok {
          finishAcknowledgements()
          let ids = Set(applied.map(\.sequence))
          records.removeAll { ids.contains($0.sequence) }
          for record in applied { acknowledgements[record.sequence] = record.kind }
          for (kind, value) in written { cache[kind] = value }
        }
        return outcome
      }
    } catch { return failure(error) }
  }
  func save(session: LearningSession) -> LearningOutcome {
    guard mutex.try() else { return .init(result: .busy) }
    defer { mutex.unlock() }
    let result = commitLocked()
    guard result == .ok else { return .init(result: result) }
    guard let current = cache[session.kind] else { return .init(result: .invalid) }
    let payload: LearningPayload?
    do { payload = try projection(session, stored: current) } catch { return .init(result: failure(error)) }
    mark(session, current)
    return .init(result: .ok, payload: payload)
  }
  func forget(_ word: String, session: LearningSession) -> LearningOutcome {
    guard LearningMutation.pin(word, 0).valid(for: .dictionary) else { return .init(result: .invalid) }
    guard mutex.try() else { return .init(result: .busy) }
    defer { mutex.unlock() }
    do {
      let change = UUID().uuidString; let key = TextNormalizer.key(word)
      var written: Stored?
      let result = try global { db in
        let outcome = transaction(db, body: {
          try synchronize(db)
          let current = try stored(.dictionary, db)
          guard case let .dictionary(snapshot) = current.payload else { throw LearningPersistenceResult.invalid }
          written = try put(.dictionary(PersonalDictionary.forgetting(word, in: snapshot)), kind: .dictionary, epoch: current.epoch, revision: current.revision, change: change, db: db)
          try db.execute("UPDATE tokens SET status=2 WHERE kind=0 AND key=? AND status=0", [.text(key)])
        }, confirm: { try db.rows("SELECT change FROM stores WHERE kind=0")[0][0].string == change })
        if outcome == .ok { finishAcknowledgements(); if let written { cache[.dictionary] = written } }
        return outcome
      }
      guard result == .ok, let written else { return .init(result: result) }
      let removed = records.filter { $0.kind == .dictionary && $0.mutation.key == key }
      let ids = Set(removed.map(\.sequence))
      records.removeAll { ids.contains($0.sequence) }
      for record in removed { acknowledgements[record.sequence] = record.kind }
      let payload = try projection(session, stored: written, force: true)
      mark(session, written)
      return .init(result: .ok, payload: payload)
    } catch { return .init(result: failure(error)) }
  }
  func clear(kinds: [LearningKind]) -> LearningOutcome {
    guard mutex.try() else { return .init(result: .busy) }
    defer { mutex.unlock() }
    do {
      return try global { db in
        let change = UUID().uuidString
        var written: [LearningKind: Stored] = [:]
        let outcome = transaction(db, body: {
          try synchronize(db)
          for kind in kinds {
            let current = try stored(kind, db)
            written[kind] = try put(.empty(kind), kind: kind, epoch: UUID().uuidString, revision: current.revision, change: change, db: db)
            try db.execute("UPDATE tokens SET status=2 WHERE kind=? AND status=0", [.int(Int64(kind.rawValue))])
          }
        }, confirm: {
          try kinds.allSatisfy { try db.rows("SELECT change FROM stores WHERE kind=?", [.int(Int64($0.rawValue))])[0][0].string == change }
        })
        guard outcome == .ok else { return .init(result: outcome) }
        finishAcknowledgements()
        for (kind, value) in written { cache[kind] = value }
        let removed = records.filter { kinds.contains($0.kind) }
        let ids = Set(removed.map(\.sequence))
        records.removeAll { ids.contains($0.sequence) }
        for record in removed { acknowledgements[record.sequence] = record.kind }
        let cleared: LearningPayload? = kinds.count == 1 ? .empty(kinds[0]) : nil
        // SQLite reset and legacy deletion are deliberately separate outcomes.
        do {
          for kind in kinds {
            let url = domain.canonical ? (kind == .dictionary ? domain.dictionary : domain.touch) : (kind == standaloneKind ? standalone : nil)
            if let url {
              try noSymlink(url)
              do { try FileManager.default.removeItem(at: url) }
              catch let error as CocoaError where error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile {}
            }
          }
        } catch { return .init(result: .cleanup, payload: cleared) }
        return .init(result: .ok, payload: cleared)
      }
    } catch { return .init(result: failure(error)) }
  }
  func hasPending(owner: UUID) -> Bool {
    guard mutex.try() else { return true }
    defer { mutex.unlock() }
    // Confirmed terminal receipts are metadata cleanup, not unsaved learning.
    // Ineligible reservations remain here until their uncertainty is resolved.
    return records.contains { $0.owner == owner }
  }
  func scheduleSave() {
    schedulerLock.lock()
    if scheduled { again = true; schedulerLock.unlock(); return }
    scheduled = true; schedulerLock.unlock()
    let finished = DispatchSemaphore(value: 0)
    queue.async { [self] in
      if mutex.try() { _ = commitLocked(); mutex.unlock() }
      schedulerLock.lock()
      let retry = again; again = false; scheduled = false
      schedulerLock.unlock()
      finished.signal()
      if retry { scheduleSave() }
    }
    #if os(iOS)
    // Keep the best-effort activity alive through this attempt. Never block the
    // input thread or wait indefinitely if the system expires/denies the request.
    ProcessInfo.processInfo.performExpiringActivity(withReason: "Saving learned keyboard data") { expired in
      if !expired { _ = finished.wait(timeout: .now() + 5) }
    }
    #endif
  }
}

private final class LearningSQL {
  static let maximumBytes = 8 * 1024 * 1024
  let handle: OpaquePointer
  private var closed = false
  enum Value {
    case int(Int64), text(String), data(Data), null
    var integer: Int64? { if case let .int(value) = self { value } else { nil } }
    var string: String? { if case let .text(value) = self { value } else { nil } }
    var data: Data? { if case let .data(value) = self { value } else { nil } }
  }
  init(url: URL, create: Bool) throws {
    var db: OpaquePointer?
    var flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
    if create { flags |= SQLITE_OPEN_CREATE }
    #if os(iOS)
    flags |= SQLITE_OPEN_FILEPROTECTION_COMPLETEUNTILFIRSTUSERAUTHENTICATION
    #endif
    guard sqlite3_open_v2(url.path, &db, flags, nil) == SQLITE_OK, let db else {
      if let db { sqlite3_close(db) }
      throw LearningPersistenceResult.io
    }
    handle = db
    sqlite3_busy_timeout(db, 0)
    sqlite3_limit(db, SQLITE_LIMIT_LENGTH, Int32(Self.maximumBytes + 1024))
    do {
      try exec("PRAGMA foreign_keys=ON")
      try exec("PRAGMA journal_mode=DELETE")
      try exec("PRAGMA synchronous=FULL")
      try exec("PRAGMA page_size=4096")
      try exec("PRAGMA max_page_count=16384")
      try exec("PRAGMA cache_size=-2048")
      try exec("PRAGMA temp_store=MEMORY")
      guard try rows("PRAGMA page_size")[0][0].integer == 4096,
            try rows("PRAGMA page_count")[0][0].integer! <= 16384 else { throw LearningPersistenceResult.capacity }
      guard chmod(url.path, S_IRUSR | S_IWUSR) == 0 else { throw LearningPersistenceResult.io }
    } catch { sqlite3_close(db); throw error }
  }
  func dispose() { if !closed { sqlite3_close_v2(handle); closed = true } }
  deinit { dispose() }
  private func check(_ code: Int32) throws {
    guard code == SQLITE_OK || code == SQLITE_ROW || code == SQLITE_DONE else {
      switch code & 0xff {
      case SQLITE_BUSY, SQLITE_LOCKED: throw LearningPersistenceResult.busy
      case SQLITE_FULL, SQLITE_TOOBIG: throw LearningPersistenceResult.capacity
      case SQLITE_CORRUPT, SQLITE_NOTADB, SQLITE_CONSTRAINT, SQLITE_MISMATCH, SQLITE_ERROR: throw LearningPersistenceResult.invalid
      default: throw LearningPersistenceResult.io
      }
    }
  }
  func exec(_ text: String) throws { try check(sqlite3_exec(handle, text, nil, nil, nil)) }
  func execute(_ text: String, _ bindings: [Value] = []) throws { _ = try rows(text, bindings) }
  func rows(_ text: String, _ bindings: [Value] = []) throws -> [[Value]] {
    var statement: OpaquePointer?
    try check(sqlite3_prepare_v2(handle, text, -1, &statement, nil))
    guard let statement else { throw LearningPersistenceResult.invalid }
    defer { sqlite3_finalize(statement) }
    let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    for (index, value) in bindings.enumerated() {
      let slot = Int32(index + 1)
      switch value {
      case let .int(value): try check(sqlite3_bind_int64(statement, slot, value))
      case let .text(value):
        guard let length = Int32(exactly: value.utf8.count) else { throw LearningPersistenceResult.capacity }
        try check(sqlite3_bind_text(statement, slot, value, length, transient))
      case let .data(value):
        try value.withUnsafeBytes { bytes in try check(sqlite3_bind_blob(statement, slot, bytes.baseAddress, Int32(bytes.count), transient)) }
      case .null: try check(sqlite3_bind_null(statement, slot))
      }
    }
    var output: [[Value]] = []
    while true {
      let code = sqlite3_step(statement); try check(code)
      if code == SQLITE_DONE { return output }
      guard output.count < 4100, sqlite3_column_count(statement) <= 12 else { throw LearningPersistenceResult.invalid }
      var row: [Value] = []
      for column in 0..<sqlite3_column_count(statement) {
        switch sqlite3_column_type(statement, column) {
        case SQLITE_INTEGER: row.append(.int(sqlite3_column_int64(statement, column)))
        case SQLITE_TEXT:
          let size = Int(sqlite3_column_bytes(statement, column))
          guard size <= Self.maximumBytes, let pointer = sqlite3_column_text(statement, column) else { throw LearningPersistenceResult.invalid }
          guard let value = String(bytes: UnsafeBufferPointer(start: pointer, count: size), encoding: .utf8) else { throw LearningPersistenceResult.invalid }
          row.append(.text(value))
        case SQLITE_BLOB:
          let size = Int(sqlite3_column_bytes(statement, column))
          guard size <= Self.maximumBytes, let pointer = sqlite3_column_blob(statement, column) else { throw LearningPersistenceResult.invalid }
          row.append(.data(Data(bytes: pointer, count: size)))
        case SQLITE_NULL: row.append(.null)
        default: throw LearningPersistenceResult.invalid
        }
      }
      output.append(row)
    }
  }
}
