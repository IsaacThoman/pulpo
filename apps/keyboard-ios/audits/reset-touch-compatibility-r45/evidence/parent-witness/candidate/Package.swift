// swift-tools-version: 6.2
import PackageDescription
let package=Package(name:"Witness",platforms:[.macOS(.v15)],dependencies:[.package(path:"/tmp/pulpo-r33-touch-compat-parent/candidate/apps/keyboard-ios/PulpoKeyboardKit")],targets:[.executableTarget(name:"Witness",dependencies:[.product(name:"KeyboardCore",package:"PulpoKeyboardKit")])])
