import Foundation

/// What the app and the extension show for an item without decrypting its secrets.
public struct VaultItemSummary: Equatable {
  public let id: String
  public let name: String
  public let username: String?
  public let uris: [LoginUri]
  public let favorite: Bool
  public let hasTotp: Bool
}

/// An SSH key item (Bitwarden's cipher type 5), without its private key.
public struct VaultSshKeySummary: Equatable {
  public let id: String
  public let name: String
  /// OpenSSH authorized_keys format, e.g. `ssh-ed25519 AAAA…`.
  public let publicKey: String?
  /// `SHA256:…`, as Bitwarden shows it.
  public let fingerprint: String?
}

public struct VaultItemSecret: Equatable {
  public let password: String?
  /// The raw TOTP field (see `Totp`).
  public let totp: String?
}

/// The cached `/api/sync` response, still encrypted. Only personal, non-deleted logins and SSH keys
/// count: organization items, the trash, and the other item types are out of scope for now. SSH
/// keys are kept apart from logins, so the item list and AutoFill never see them.
///
/// Two snapshots are equal when they hold the same items, whatever order the server sent them in.
/// The raw responses can differ even then (e.g. signed attachment URLs that are minted per
/// request), so compare snapshots, not bytes, to tell whether a sync changed anything.
public struct VaultSnapshot: Equatable {
  struct Cipher: Equatable {
    struct Uri: Equatable {
      let uri: String?
      let match: Int?
    }

    let id: String
    /// Per-item key, wrapped with the user key. Newer clients set one on every item they save.
    let key: String?
    let name: String?
    let favorite: Bool
    let username: String?
    let password: String?
    let totp: String?
    let uris: [Uri]
  }

  struct SshKeyCipher: Equatable {
    let id: String
    let key: String?
    let name: String?
    let privateKey: String?
    let publicKey: String?
    let fingerprint: String?
  }

  let ciphers: [Cipher]
  let sshKeys: [SshKeyCipher]

  public init(syncResponse data: Data) throws {
    guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let all = root.field("ciphers") as? [[String: Any]]
    else {
      throw VaultError.invalidResponse("sync response has no ciphers")
    }
    let personal = all.filter { cipher in
      cipher.field("id") is String
        && (cipher.field("organizationId") is NSNull || cipher.field("organizationId") == nil)
        && (cipher.field("deletedDate") is NSNull || cipher.field("deletedDate") == nil)
    }

    sshKeys = personal.compactMap { cipher in
      guard let id = cipher.field("id") as? String, cipher.field("type") as? Int == 5,
        let sshKey = cipher.field("sshKey") as? [String: Any]
      else { return nil }
      return SshKeyCipher(
        id: id,
        key: cipher.field("key") as? String,
        name: cipher.field("name") as? String,
        privateKey: sshKey.field("privateKey") as? String,
        publicKey: sshKey.field("publicKey") as? String,
        fingerprint: sshKey.field("keyFingerprint") as? String)
    }

    ciphers = personal.compactMap { cipher in
      guard let id = cipher.field("id") as? String,
        cipher.field("type") as? Int == 1,
        let login = cipher.field("login") as? [String: Any]
      else { return nil }

      let uris = (login.field("uris") as? [[String: Any]] ?? []).map {
        Cipher.Uri(uri: $0.field("uri") as? String, match: $0.field("match") as? Int)
      }
      return Cipher(
        id: id,
        key: cipher.field("key") as? String,
        name: cipher.field("name") as? String,
        favorite: cipher.field("favorite") as? Bool ?? false,
        username: login.field("username") as? String,
        password: login.field("password") as? String,
        totp: login.field("totp") as? String,
        uris: uris)
    }
  }

  /// The number of logins.
  public var count: Int { ciphers.count }

  public static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.ciphers.sorted { $0.id < $1.id } == rhs.ciphers.sorted { $0.id < $1.id }
      && lhs.sshKeys.sorted { $0.id < $1.id } == rhs.sshKeys.sorted { $0.id < $1.id }
  }

  /// Decrypts every item's summary. Items that fail to decrypt are skipped, unless they all
  /// fail, which means the user key is wrong (e.g. the account's keys were rotated).
  public func summaries(userKey: VaultKey) throws -> [VaultItemSummary] {
    let summaries = ciphers.compactMap { try? summary(of: $0, userKey: userKey) }
    if summaries.isEmpty && !ciphers.isEmpty {
      throw VaultError.decryptionFailed
    }
    return summaries
  }

  public func summary(id: String, userKey: VaultKey) throws -> VaultItemSummary {
    try summary(of: cipher(id), userKey: userKey)
  }

  public func secret(id: String, userKey: VaultKey) throws -> VaultItemSecret {
    let cipher = try cipher(id)
    let key = try itemKey(cipher, userKey: userKey)
    return VaultItemSecret(
      password: try cipher.password.map { try EncString($0).decryptString(with: key) },
      totp: try cipher.totp.map { try EncString($0).decryptString(with: key) })
  }

  /// Decrypts every SSH key's name, public key and fingerprint. Like `summaries`, items that fail
  /// are skipped unless they all do.
  public func sshKeySummaries(userKey: VaultKey) throws -> [VaultSshKeySummary] {
    let summaries = sshKeys.compactMap { cipher -> VaultSshKeySummary? in
      guard let key = try? itemKey(key: cipher.key, userKey: userKey) else { return nil }
      return try? VaultSshKeySummary(
        id: cipher.id,
        name: cipher.name.map { try EncString($0).decryptString(with: key) } ?? "",
        publicKey: cipher.publicKey.map { try EncString($0).decryptString(with: key) },
        fingerprint: cipher.fingerprint.map { try EncString($0).decryptString(with: key) })
    }
    if summaries.isEmpty && !sshKeys.isEmpty {
      throw VaultError.decryptionFailed
    }
    return summaries
  }

  /// Decrypts one SSH key's private key (OpenSSH format, as Bitwarden stores it).
  public func sshPrivateKey(id: String, userKey: VaultKey) throws -> String {
    guard let cipher = sshKeys.first(where: { $0.id == id }), let privateKey = cipher.privateKey else {
      throw VaultError.itemNotFound
    }
    return try EncString(privateKey).decryptString(with: itemKey(key: cipher.key, userKey: userKey))
  }

  private func cipher(_ id: String) throws -> Cipher {
    guard let cipher = ciphers.first(where: { $0.id == id }) else { throw VaultError.itemNotFound }
    return cipher
  }

  private func summary(of cipher: Cipher, userKey: VaultKey) throws -> VaultItemSummary {
    let key = try itemKey(cipher, userKey: userKey)
    let uris = try cipher.uris.compactMap { entry -> LoginUri? in
      guard let uri = entry.uri else { return nil }
      return LoginUri(
        uri: try EncString(uri).decryptString(with: key),
        match: entry.match.flatMap(UriMatchType.init(rawValue:)))
    }
    return VaultItemSummary(
      id: cipher.id,
      name: try cipher.name.map { try EncString($0).decryptString(with: key) } ?? "",
      username: try cipher.username.map { try EncString($0).decryptString(with: key) },
      uris: uris,
      favorite: cipher.favorite,
      hasTotp: cipher.totp != nil)
  }

  private func itemKey(_ cipher: Cipher, userKey: VaultKey) throws -> VaultKey {
    try itemKey(key: cipher.key, userKey: userKey)
  }

  private func itemKey(key: String?, userKey: VaultKey) throws -> VaultKey {
    guard let key else { return userKey }
    return try VaultKey(data: EncString(key).decrypt(with: userKey))
  }
}

extension Dictionary where Key == String, Value == Any {
  /// Looks up a JSON field, tolerating the PascalCase older Vaultwarden versions send.
  func field(_ name: String) -> Any? {
    if let value = self[name] {
      return value
    }
    return first { $0.key.caseInsensitiveCompare(name) == .orderedSame }?.value
  }
}
