import AppKit

// pulpo-control: sees and controls other apps' windows for the agent, in the background. The
// protocol is apps/desktop/src/computer/control/protocol.ts.
//
// The main thread runs AppKit, which the agent's pointer window needs. Requests are read on a
// thread of their own and handled on another, one at a time, in order, each on a fresh thread, so
// a request stuck in a hung app can be answered with `failed` and left behind without blocking the
// next, and the end of input is noticed while a request is still running.

let output = Output() // First: from here on, nothing but answers reaches standard output.
signal(SIGPIPE, SIG_IGN)

final class Server: @unchecked Sendable {
  /// No request should take longer; typing long text gets more (see `timeout(for:)`).
  static let requestTimeout: TimeInterval = 10

  /// After input closes, a request still running gets this long to end by itself.
  static let closingGrace: TimeInterval = 1

  private let condition = NSCondition()
  private var waiting: [String] = []
  private var closed = false
  /// The request being handled, so the end of input can tell it to stop.
  private var current: RequestContext?

  func readLoop() {
    while let line = readLine(strippingNewline: true) {
      condition.lock()
      waiting.append(line)
      condition.signal()
      condition.unlock()
    }
    // Input closed: the app is done with the helper (the reply was stopped, its access taken back,
    // or the app quit). What is running is told to stop where it is, so text being typed does not
    // run on; what was still waiting is not started.
    condition.lock()
    closed = true
    let running = current
    condition.signal()
    condition.unlock()
    guard let running else { _exit(0) }
    running.abandon()
    Thread.sleep(forTimeInterval: Self.closingGrace)
    _exit(0)
  }

  func handleLoop() {
    while true {
      condition.lock()
      while waiting.isEmpty && !closed { condition.wait() }
      if closed {
        condition.unlock()
        _exit(0)
      }
      let line = waiting.removeFirst()
      condition.unlock()
      if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
      handle(line)
    }
  }

  private func handle(_ line: String) {
    guard let object = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? JSON else {
      output.send(["id": 0, "ok": false, "code": "invalid_request", "message": "The request is not a JSON object."])
      return
    }
    let id = object["id"] as? NSNumber ?? 0
    guard let method = object.string("method") else {
      output.send(["id": id, "ok": false, "code": "invalid_request", "message": "The request has no `method`."])
      return
    }
    let params = object.object("params") ?? [:]
    let timeout = Self.timeout(for: method, params: params)
    let context = RequestContext(timeout: timeout)
    condition.lock()
    current = context
    condition.unlock()
    defer {
      condition.lock()
      current = nil
      condition.unlock()
    }

    final class Box: @unchecked Sendable { var answer: JSON = [:] }
    let box = Box()
    let done = DispatchSemaphore(value: 0)
    let thread = Thread {
      box.answer = self.answer(method: method, params: params, context: context)
      done.signal()
    }
    thread.stackSize = 8 << 20
    thread.start()

    var answer: JSON
    var abandonedAction = false
    if done.wait(timeout: .now() + timeout) == .timedOut {
      context.abandon()
      log("\(method) did not finish in \(Int(timeout)) s")
      answer = ["ok": false, "code": "failed", "message": "The request took too long; the app may not be responding."]
      abandonedAction = method == "act"
    } else {
      answer = box.answer
    }
    answer["id"] = id
    output.send(answer)
    // An action that did not finish is still on its thread, stuck in the app, and would carry on
    // (press the button, post the keys) whenever the app answers, after the agent was told it
    // failed. The helper leaves instead; the app starts another for the next request.
    if abandonedAction { _exit(0) }
  }

  private static func timeout(for method: String, params: JSON) -> TimeInterval {
    if method == "act", let action = params.object("action"), action.string("type") == "type", let text = action.string("text") {
      return requestTimeout + Double(text.count) / 400
    }
    return requestTimeout
  }

  private func answer(method: String, params: JSON, context: RequestContext) -> JSON {
    do {
      let result: JSON
      switch method {
      case "configure": result = try configure(params)
      case "permissions": result = Permissions.answer(prompt: params.bool("prompt") ?? false)
      case "apps": result = ["apps": Apps.list(context)]
      case "snapshot": result = try Snapshot.take(params: params, context: context)
      case "act": result = try Act.run(params: params, context: context)
      case "release":
        AgentPointer.shared.release()
        result = [:]
      default: throw ControlError.invalidRequest("`\(method)` is not a method.")
      }
      return ["ok": true, "result": result]
    } catch let error as ControlError {
      return ["ok": false, "code": error.code, "message": error.message]
    } catch {
      return ["ok": false, "code": "failed", "message": error.localizedDescription]
    }
  }

  private func configure(_ params: JSON) throws -> JSON {
    guard let pids = params["excludePids"] as? [NSNumber] else { throw ControlError.invalidRequest("`excludePids` must be a list of process ids.") }
    let imageDir = try params.requireString("imageDir")
    let maxImageEdge = try params.requireDouble("maxImageEdge")
    guard maxImageEdge >= 16 else { throw ControlError.invalidRequest("`maxImageEdge` must be at least 16.") }
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: imageDir, isDirectory: &isDirectory), isDirectory.boolValue else {
      throw ControlError.invalidRequest("`imageDir` is not a folder.")
    }
    State.shared.configure { config in
      config.excludePids = Set(pids.map { pid_t(truncatingIfNeeded: $0.intValue) })
      config.imageDir = URL(fileURLWithPath: imageDir, isDirectory: true)
      config.maxImageEdge = maxImageEdge
    }
    return ["protocol": 1, "platform": "macos", "background": true]
  }
}

// AppKit must be set up before CoreGraphics is used at all (window lists and captures fail with
// CGS_REQUIRE_INIT otherwise), and the accessory policy keeps the helper out of the Dock, the app
// switcher and the menu bar.
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
AX.setUp()

let server = Server()
Thread.detachNewThread { server.readLoop() }
Thread.detachNewThread { server.handleLoop() }
application.run()
