import Foundation

/// Where the app and the AutoFill extension find each other's state. Both targets put these keys
/// in their Info.plist (with `$(AppIdentifierPrefix)` expanded at build time).
public struct VaultEnvironment {
  public let appGroup: String
  /// Holds the Face ID protected user key; both targets can read it.
  public let sharedKeychainGroup: String
  /// Holds the refresh token and device identifier; only the app sets this.
  public let appKeychainGroup: String?

  public init(appGroup: String, sharedKeychainGroup: String, appKeychainGroup: String?) {
    self.appGroup = appGroup
    self.sharedKeychainGroup = sharedKeychainGroup
    self.appKeychainGroup = appKeychainGroup
  }

  public static func fromInfoPlist(_ bundle: Bundle = .main) throws -> VaultEnvironment {
    func value(_ key: String) -> String? {
      bundle.object(forInfoDictionaryKey: key) as? String
    }
    guard let appGroup = value("SapphireVaultAppGroup") else {
      throw VaultError.misconfigured("SapphireVaultAppGroup is missing from Info.plist")
    }
    guard let sharedKeychainGroup = value("SapphireVaultSharedKeychainGroup") else {
      throw VaultError.misconfigured("SapphireVaultSharedKeychainGroup is missing from Info.plist")
    }
    return VaultEnvironment(
      appGroup: appGroup, sharedKeychainGroup: try withTeamPrefix(sharedKeychainGroup),
      appKeychainGroup: try value("SapphireVaultAppKeychainGroup").map(withTeamPrefix))
  }

  /// `$(AppIdentifierPrefix)` expands to nothing when a build isn't signed with a team, which
  /// would leave a group that matches no entitlement. Fill the prefix in from the Keychain.
  static func withTeamPrefix(_ group: String) throws -> String {
    if group.range(of: #"^[A-Z0-9]{10}\."#, options: .regularExpression) != nil {
      return group
    }
    return try Keychain.teamPrefix() + group
  }
}

public struct VaultAccount: Codable, Equatable {
  public let serverURL: String
  public let email: String
}

/// Non-secret state in the App Group: the account, sync bookkeeping, and the encrypted cache.
public final class SharedStore {
  private enum Key {
    static let account = "vault.account"
    static let serverURL = "vault.serverURL"
    static let lastSync = "vault.lastSync"
    static let needsReauth = "vault.needsReauth"
  }

  private let defaults: UserDefaults
  private let cacheURL: URL

  public init(appGroup: String) throws {
    guard let defaults = UserDefaults(suiteName: appGroup),
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
    else {
      throw VaultError.misconfigured("App Group \(appGroup) isn't available to this target")
    }
    self.defaults = defaults
    cacheURL = container.appending(path: "vault", directoryHint: .isDirectory).appending(path: "sync.json")
  }

  public var account: VaultAccount? {
    get { defaults.data(forKey: Key.account).flatMap { try? JSONDecoder().decode(VaultAccount.self, from: $0) } }
    set { defaults.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: Key.account) }
  }

  /// The last server logged in to, kept across logouts to prefill the login form.
  public var serverURL: String? {
    get { defaults.string(forKey: Key.serverURL) }
    set { defaults.set(newValue, forKey: Key.serverURL) }
  }

  public var lastSync: Date? {
    get { defaults.object(forKey: Key.lastSync) as? Date }
    set { defaults.set(newValue, forKey: Key.lastSync) }
  }

  public var needsReauth: Bool {
    get { defaults.bool(forKey: Key.needsReauth) }
    set { defaults.set(newValue, forKey: Key.needsReauth) }
  }

  public func readCache() throws -> Data? {
    guard FileManager.default.fileExists(atPath: cacheURL.path) else { return nil }
    return try Data(contentsOf: cacheURL)
  }

  public func writeCache(_ data: Data) throws {
    try FileManager.default.createDirectory(
      at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: cacheURL, options: [.atomic, .completeFileProtection])
  }

  public func wipe() {
    account = nil
    lastSync = nil
    needsReauth = false
    try? FileManager.default.removeItem(at: cacheURL)
  }
}
