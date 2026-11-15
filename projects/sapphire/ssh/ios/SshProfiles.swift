import Foundation
import SapphireVaultCore

/// A machine the app has logged in to. Profiles themselves aren't secret; a password lives in the
/// Keychain under the profile's id, and a vault key is referenced by its item id.
struct SshProfile: Codable, Equatable {
  enum Auth: String, Codable {
    case password
    case vaultKey
  }

  /// `user@host:port`, so logging in to the same machine as the same user replaces the profile.
  let id: String
  let host: String
  let port: Int
  let username: String
  let label: String
  let auth: Auth
  let vaultKeyId: String?
  let vaultKeyName: String?
  var lastUsed: Date?

  static func id(host: String, port: Int, username: String) -> String {
    "\(username)@\(normalizeHost(host)):\(port)"
  }
}

/// MagicDNS names are case-insensitive and may come with the root's trailing dot.
func normalizeHost(_ host: String) -> String {
  var host = host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  while host.hasSuffix(".") {
    host.removeLast()
  }
  return host
}

/// Profiles in UserDefaults; passwords in the app's Keychain group, readable only with Face ID
/// (`.biometryCurrentSet`, this device only). Changing Face ID enrollment destroys the passwords,
/// and the profiles then ask for them again.
final class SshProfileStore {
  static let keychainService = "dev.wuguishifu.sapphire.ssh"
  private static let defaultsKey = "ssh.profiles"

  private let defaults: UserDefaults
  private let keychain: Keychain
  private let lock = NSLock()

  init(environment: VaultEnvironment, defaults: UserDefaults = .standard) throws {
    guard let group = environment.appKeychainGroup else {
      throw SshError.misconfigured("no app keychain group")
    }
    self.defaults = defaults
    keychain = Keychain(accessGroup: group, service: Self.keychainService)
  }

  var profiles: [SshProfile] {
    lock.withLock { load() }
  }

  func profile(id: String) throws -> SshProfile {
    guard let profile = profiles.first(where: { $0.id == id }) else { throw SshError.profileNotFound }
    return profile
  }

  /// Saves the profile, and its password if it uses one. Writing a Face ID protected item doesn't
  /// prompt; only reading it does.
  func save(_ profile: SshProfile, password: String?) throws {
    if let password {
      try keychain.set(Data(password.utf8), account: profile.id, protection: .biometryCurrentSet)
    } else {
      keychain.delete(account: profile.id)
    }
    lock.withLock {
      var profiles = load().filter { $0.id != profile.id }
      profiles.append(profile)
      store(profiles)
    }
  }

  func touch(id: String) {
    lock.withLock {
      var profiles = load()
      guard let index = profiles.firstIndex(where: { $0.id == id }) else { return }
      profiles[index].lastUsed = Date()
      store(profiles)
    }
  }

  func delete(id: String) {
    keychain.delete(account: id)
    lock.withLock { store(load().filter { $0.id != id }) }
  }

  /// Face ID, then the saved password. Blocks on the prompt, so call it off the main thread.
  func password(for profile: SshProfile) throws -> String {
    guard let data = try keychain.get(account: profile.id, prompt: "Connect to \(profile.label)"),
      let password = String(data: data, encoding: .utf8)
    else {
      throw SshError.credentialsMissing
    }
    return password
  }

  private func load() -> [SshProfile] {
    defaults.data(forKey: Self.defaultsKey).flatMap { try? JSONDecoder().decode([SshProfile].self, from: $0) } ?? []
  }

  private func store(_ profiles: [SshProfile]) {
    defaults.set(try? JSONEncoder().encode(profiles), forKey: Self.defaultsKey)
  }
}
