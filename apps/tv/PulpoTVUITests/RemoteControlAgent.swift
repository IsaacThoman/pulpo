import XCTest

/// A Siri Remote you can drive from a shell, for exploratory testing in the
/// simulator (whose window has no remote of its own when streamed).
///
/// Run only this test with `PULPO_REMOTE_AGENT=<directory>` in the test
/// runner's environment (`TEST_RUNNER_PULPO_REMOTE_AGENT` for xcodebuild).
/// Append commands to `<directory>/commands`, one per line:
///
///     up | down | left | right | select | menu | playpause | home
///     hold                      press and hold Select (context menus)
///     type <text>               type into the focused text field (`\n` presses Return)
///     launch [arguments…]       relaunch the app, e.g. `launch -PulpoMock -PulpoSignedIn`
///     focus                     write the focused element to `<directory>/output`
///     tree                      write the accessibility tree to `<directory>/output`
///     wait <seconds>
///     quit
///
/// Each processed line is echoed to `<directory>/done`.
@MainActor
final class RemoteControlAgent: XCTestCase {
    func testRemoteControlAgent() throws {
        guard let directory = ProcessInfo.processInfo.environment["PULPO_REMOTE_AGENT"] else {
            throw XCTSkip("Set PULPO_REMOTE_AGENT to drive the app from a shell.")
        }
        let commands = URL(fileURLWithPath: directory).appendingPathComponent("commands")
        let done = URL(fileURLWithPath: directory).appendingPathComponent("done")
        let output = URL(fileURLWithPath: directory).appendingPathComponent("output")
        var app = XCUIApplication()
        var processed = 0
        let remote = XCUIRemote.shared

        while true {
            let lines = (try? String(contentsOf: commands, encoding: .utf8))?.components(separatedBy: "\n").filter { !$0.isEmpty } ?? []
            guard processed < lines.count else {
                Thread.sleep(forTimeInterval: 0.15)
                continue
            }
            let line = lines[processed]
            processed += 1
            let parts = line.split(separator: " ", maxSplits: 1).map(String.init)
            switch parts.first ?? "" {
            case "up": remote.press(.up)
            case "down": remote.press(.down)
            case "left": remote.press(.left)
            case "right": remote.press(.right)
            case "select": remote.press(.select)
            case "menu": remote.press(.menu)
            case "playpause": remote.press(.playPause)
            case "home": remote.press(.home)
            case "hold": remote.press(.select, forDuration: 1.6)
            case "type": app.typeText((parts.count > 1 ? parts[1] : "").replacingOccurrences(of: "\\n", with: "\n"))
            case "launch":
                app = XCUIApplication()
                app.launchArguments = parts.count > 1 ? parts[1].split(separator: " ").map(String.init) : []
                app.launch()
            case "focus":
                let focused = app.descendants(matching: .any).element(matching: NSPredicate(format: "hasFocus == true"))
                let description = focused.exists ? "\(focused.elementType.rawValue) id=\(focused.identifier) label=\(focused.label)" : "none"
                try? description.write(to: output, atomically: true, encoding: .utf8)
            case "tree": try? app.debugDescription.write(to: output, atomically: true, encoding: .utf8)
            case "wait": Thread.sleep(forTimeInterval: Double(parts.count > 1 ? parts[1] : "1") ?? 1)
            case "quit": return
            default: break
            }
            Thread.sleep(forTimeInterval: 0.35)
            let handle = try? FileHandle(forWritingTo: done)
            if let handle {
                handle.seekToEndOfFile()
                handle.write(Data((line + "\n").utf8))
                try? handle.close()
            } else {
                try? (line + "\n").write(to: done, atomically: true, encoding: .utf8)
            }
        }
    }
}
