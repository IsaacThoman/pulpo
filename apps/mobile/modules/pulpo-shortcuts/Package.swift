// swift-tools-version: 6.0
import PackageDescription
let package = Package(
  name: "PulpoShortcutsCore",
  platforms: [.macOS(.v13)],
  products: [.library(name: "PulpoShortcutsCore", targets: ["PulpoShortcutsCore"]), .executable(name: "PulpoShortcutsAcceptance", targets: ["PulpoShortcutsAcceptance"])],
  targets: [
    .target(name: "PulpoShortcutsCore", path: "ios", exclude: ["PulpoShortcutsModule.swift", "PulpoShortcuts.podspec"]),
    .executableTarget(name: "PulpoShortcutsAcceptance", dependencies: ["PulpoShortcutsCore"], path: "Acceptance"),
    .testTarget(name: "PulpoShortcutsCoreTests", dependencies: ["PulpoShortcutsCore"], path: "Tests"),
  ],
  swiftLanguageModes: [.v5]
)
