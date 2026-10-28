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

public struct VaultItemSecret: Equatable {
  public let password: String?
  /// The raw TOTP field (see `Totp`).
  public let totp: String?
}

/// The cached `/api/sync` response, still encrypted. Only personal, non-deleted logins count:
/// organization items, the trash, and the other item types are out of scope for now.
public struct VaultSnapshot {
  struct Cipher {
    let id: String
    /// Per-item key, wrapped with the user key. Newer clients set one on every item they save.
    let key: String?
    let name: String?
    let favorite: Bool
    let username: String?
    let password: String?
    let totp: String?
    let uris: [(uri: String?, match: Int?)]
  }

  let ciphers: [Cipher]

  public init(syncResponse data: Data) throws {
    guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let ciphers = root.field("ciphers") as? [[String: Any]]
    else {
      throw VaultError.invalidResponse("sync response has no ciphers")
    }

    self.ciphers = ciphers.compactMap { cipher in
      guard let id = cipher.field("id") as? String,
        cipher.field("type") as? Int == 1,
        cipher.field("organizationId") is NSNull || cipher.field("organizationId") == nil,
        cipher.field("deletedDate") is NSNull || cipher.field("deletedDate") == nil,
        let login = cipher.field("login") as? [String: Any]
      else { return nil }

      let uris = (login.field("uris") as? [[String: Any]] ?? []).map {
        (uri: $0.field("uri") as? String, match: $0.field("match") as? Int)
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

  public var count: Int { ciphers.count }

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
    guard let key = cipher.key else { return userKey }
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
