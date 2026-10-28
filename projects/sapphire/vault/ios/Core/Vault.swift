import Foundation

public struct VaultState {
  public let loggedIn: Bool
  /// The account's server, or the last one used (or the default) when logged out.
  public let serverURL: String
  public let email: String?
  public let lastSync: Date?
  /// The refresh token was rejected; the cache still works, but sync needs the master password.
  public let needsReauth: Bool
  /// The Face ID protected user key exists. False while logged in means Face ID changed.
  public let keyAvailable: Bool
}

/// The vault's account lifecycle. The app uses all of it; the extension only reads the user key
/// and the snapshot.
public actor Vault {
  public static let defaultServerURL = "https://vault.wuguishifu.dev"
  public static let deviceName = "Sapphire (iPhone)"

  private enum Account {
    static let userKey = "userKey"
    static let refreshToken = "refreshToken"
    static let deviceIdentifier = "deviceIdentifier"
  }

  nonisolated let store: SharedStore
  nonisolated let sharedKeychain: Keychain
  nonisolated let appKeychain: Keychain?

  private var accessToken: (token: String, expires: Date)?
  private var inFlightSync: Task<Date, Error>?

  public init(environment: VaultEnvironment) throws {
    store = try SharedStore(appGroup: environment.appGroup)
    sharedKeychain = Keychain(accessGroup: environment.sharedKeychainGroup)
    appKeychain = environment.appKeychainGroup.map(Keychain.init(accessGroup:))
  }

  public nonisolated func state() -> VaultState {
    let account = store.account
    return VaultState(
      loggedIn: account != nil,
      serverURL: account?.serverURL ?? store.serverURL ?? Self.defaultServerURL,
      email: account?.email,
      lastSync: store.lastSync,
      needsReauth: store.needsReauth,
      keyAvailable: sharedKeychain.presence(account: Account.userKey) == .present)
  }

  // MARK: - Shared with the extension

  /// Reads the user key, prompting for Face ID. Blocks on the prompt, so call it off the main
  /// thread. Callers drop the key as soon as they're done with it.
  public nonisolated func userKey(prompt: String) throws -> VaultKey {
    guard store.account != nil else { throw VaultError.notLoggedIn }
    guard let data = try sharedKeychain.get(account: Account.userKey, prompt: prompt) else {
      throw VaultError.keyUnavailable
    }
    return try VaultKey(data: data)
  }

  public nonisolated func snapshot() throws -> VaultSnapshot {
    guard store.account != nil, let data = try store.readCache() else { throw VaultError.notLoggedIn }
    return try VaultSnapshot(syncResponse: data)
  }

  // MARK: - App only

  /// Logs in with the master password and stores what Face ID unlock needs. Logging in to a
  /// different account or server wipes the previous one first.
  public func login(serverURL rawServerURL: String, email rawEmail: String, password: String, session: URLSession)
    async throws
  {
    let appKeychain = try requireAppKeychain()
    let serverURL = try normalizeServerURL(rawServerURL)
    let email = rawEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let api = VaultApi(baseURL: URL(string: serverURL)!, session: session)

    let iterations = try await api.prelogin(email: email)
    let masterKey = try KeyDerivation.masterKey(password: password, email: email, iterations: iterations)
    let hash = try KeyDerivation.masterPasswordHash(masterKey: masterKey, password: password)
    let token = try await api.login(
      email: email, masterPasswordHash: hash,
      device: DeviceInfo(identifier: try deviceIdentifier(appKeychain), name: Self.deviceName))
    guard let encryptedUserKey = token.encryptedUserKey, let refreshToken = token.refreshToken else {
      throw VaultError.invalidResponse("login response has no Key or refresh_token")
    }
    let userKey = try KeyDerivation.userKey(encrypted: encryptedUserKey, masterKey: masterKey)

    let account = VaultAccount(serverURL: serverURL, email: email)
    if let existing = store.account, existing != account {
      wipe()
    }
    try sharedKeychain.set(userKey.data, account: Account.userKey, protection: .biometryCurrentSet)
    try appKeychain.set(Data(refreshToken.utf8), account: Account.refreshToken, protection: .afterFirstUnlock)
    store.account = account
    store.serverURL = serverURL
    store.needsReauth = false
    accessToken = (token.accessToken, Date().addingTimeInterval(token.expiresIn))
  }

  /// Fetches `/api/sync` and replaces the cache. Concurrent calls share one request.
  public func sync(session: URLSession) async throws -> Date {
    if let inFlightSync {
      return try await inFlightSync.value
    }
    let task = Task { try await performSync(session: session) }
    inFlightSync = task
    defer { inFlightSync = nil }
    return try await task.value
  }

  /// Forgets the account on this device. Vaultwarden has no endpoint to revoke a refresh token,
  /// so the device stays in the account's device list. The device identifier is kept, so logging
  /// in again reuses that entry.
  public func logout() {
    wipe()
  }

  private func performSync(session: URLSession) async throws -> Date {
    guard let account = store.account else { throw VaultError.notLoggedIn }
    let api = VaultApi(baseURL: URL(string: account.serverURL)!, session: session)

    let data: Data
    do {
      data = try await api.sync(accessToken: try await validAccessToken(api))
    } catch VaultError.server(let status, _) where status == 401 {
      // The access token was revoked early (e.g. a password change); refresh once and retry.
      accessToken = nil
      data = try await api.sync(accessToken: try await validAccessToken(api))
    }
    _ = try VaultSnapshot(syncResponse: data)

    try store.writeCache(data)
    let now = Date()
    store.lastSync = now
    return now
  }

  private func validAccessToken(_ api: VaultApi) async throws -> String {
    if let accessToken, accessToken.expires.timeIntervalSinceNow > 60 {
      return accessToken.token
    }
    let appKeychain = try requireAppKeychain()
    guard let stored = try appKeychain.get(account: Account.refreshToken),
      let refreshToken = String(data: stored, encoding: .utf8)
    else {
      store.needsReauth = true
      throw VaultError.reauthRequired
    }

    let token: TokenResponse
    do {
      token = try await api.refresh(refreshToken: refreshToken)
    } catch VaultError.reauthRequired {
      store.needsReauth = true
      throw VaultError.reauthRequired
    }
    if let rotated = token.refreshToken, rotated != refreshToken {
      try appKeychain.set(Data(rotated.utf8), account: Account.refreshToken, protection: .afterFirstUnlock)
    }
    store.needsReauth = false
    accessToken = (token.accessToken, Date().addingTimeInterval(token.expiresIn))
    return token.accessToken
  }

  private func wipe() {
    sharedKeychain.delete(account: Account.userKey)
    appKeychain?.delete(account: Account.refreshToken)
    accessToken = nil
    store.wipe()
  }

  private func requireAppKeychain() throws -> Keychain {
    guard let appKeychain else { throw VaultError.misconfigured("no app keychain group") }
    return appKeychain
  }

  private func deviceIdentifier(_ keychain: Keychain) throws -> String {
    if let data = try keychain.get(account: Account.deviceIdentifier), let id = String(data: data, encoding: .utf8) {
      return id
    }
    let id = UUID().uuidString.lowercased()
    try keychain.set(Data(id.utf8), account: Account.deviceIdentifier, protection: .afterFirstUnlock)
    return id
  }
}

func normalizeServerURL(_ raw: String) throws -> String {
  var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
  while value.hasSuffix("/") {
    value.removeLast()
  }
  guard let url = URL(string: value), let scheme = url.scheme?.lowercased(),
    scheme == "https" || scheme == "http", url.host() != nil
  else {
    throw VaultError.misconfigured("\(raw) isn't an http(s) URL")
  }
  return value
}
