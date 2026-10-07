// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "PulpoKeyboardKit",
  platforms: [.iOS(.v18), .macOS(.v15)],
  products: [
    .library(name: "KeyboardCore", targets: ["KeyboardCore"]),
    .library(name: "KeyboardUI", targets: ["KeyboardUI"]),
    .library(name: "PulpoServices", targets: ["PulpoServices"]),
  ],
  targets: [
    .target(name: "KeyboardCore"),
    .target(
      name: "KeyboardUI",
      dependencies: ["KeyboardCore"],
      swiftSettings: [.defaultIsolation(MainActor.self)]
    ),
    .target(name: "PulpoServices", dependencies: ["KeyboardCore"]),
    .testTarget(name: "KeyboardCoreTests", dependencies: ["KeyboardCore"]),
    .testTarget(name: "PulpoServicesTests", dependencies: ["PulpoServices"]),
  ],
  swiftLanguageModes: [.v6]
)
