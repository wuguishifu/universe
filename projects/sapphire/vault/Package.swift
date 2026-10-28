// swift-tools-version:5.9
// Lets `swift test` run the core on macOS. The app and the AutoFill extension consume the same
// sources through CocoaPods (ios/SapphireVaultCore.podspec).
import PackageDescription

let package = Package(
  name: "SapphireVaultCore",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "SapphireVaultCore", targets: ["SapphireVaultCore"])
  ],
  targets: [
    .target(
      name: "SapphireVaultCore",
      path: "ios/Core",
      resources: [.copy("Resources/public_suffix_list.dat")]
    ),
    .testTarget(
      name: "SapphireVaultCoreTests",
      dependencies: ["SapphireVaultCore"],
      path: "tests/SapphireVaultCoreTests",
      resources: [.copy("Fixtures")]
    ),
  ]
)
