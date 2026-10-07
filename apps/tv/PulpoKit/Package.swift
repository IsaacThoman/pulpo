// swift-tools-version: 6.0
import PackageDescription

// Platform-independent core of the Apple TV app: networking, the response
// stream, chat models, and the markdown parser. It also builds for macOS so
// `swift test` runs without a simulator.
let package = Package(
    name: "PulpoKit",
    platforms: [.tvOS("26.0"), .macOS("15.0")],
    products: [
        .library(name: "PulpoKit", targets: ["PulpoKit"]),
    ],
    targets: [
        .target(name: "PulpoKit"),
        .testTarget(name: "PulpoKitTests", dependencies: ["PulpoKit"]),
    ]
)
