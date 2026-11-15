import ExpoModulesCore
import SapphireProxy
import SapphireVaultCore
import UIKit

enum SshError: Error, LocalizedError {
  /// Face ID was canceled or failed.
  case canceled
  /// The profile's saved password is gone, e.g. because Face ID enrollment changed.
  case credentialsMissing
  /// The profile's vault key needs the vault, which is logged out or needs the master password.
  case vaultLocked
  case profileNotFound
  case sessionNotFound
  case misconfigured(String)
  case vault(VaultError)
  case tailnet(TailnetSshError)

  var code: String {
    switch self {
    case .canceled: "ERR_SSH_CANCELED"
    case .credentialsMissing: "ERR_SSH_CREDENTIALS_MISSING"
    case .vaultLocked: "ERR_SSH_VAULT_LOCKED"
    case .profileNotFound: "ERR_SSH_PROFILE_NOT_FOUND"
    case .sessionNotFound: "ERR_SSH_SESSION_NOT_FOUND"
    case .misconfigured: "ERR_SSH_MISCONFIGURED"
    case .vault(let error): error.code
    case .tailnet(let error): error.code
    }
  }

  var errorDescription: String? {
    switch self {
    case .canceled: "Canceled."
    case .credentialsMissing: "The saved password is gone (Face ID changed). Enter it again."
    case .vaultLocked: "This machine uses an SSH key from the vault. Log in to the vault first."
    case .profileNotFound: "This machine isn't saved anymore."
    case .sessionNotFound: "This session has ended."
    case .misconfigured(let message): "SSH misconfigured: \(message)"
    case .vault(let error): error.localizedDescription
    case .tailnet(let error): error.message
    }
  }

  init(_ error: Error) {
    switch error {
    case let error as SshError:
      self = error
    case let error as TailnetSshError:
      self = .tailnet(error)
    case VaultError.userCanceled, VaultError.authenticationFailed:
      self = .canceled
    case VaultError.notLoggedIn, VaultError.keyUnavailable:
      self = .vaultLocked
    case let error as VaultError:
      self = .vault(error)
    default:
      self = .misconfigured(error.localizedDescription)
    }
  }
}

struct ConnectOptions: Record {
  @Field var host: String = ""
  @Field var port: Int = 22
  @Field var username: String = ""
  /// What the list shows; defaults to the host.
  @Field var label: String?
  /// Exactly one of these.
  @Field var password: String?
  @Field var vaultKeyId: String?
  @Field var vaultKeyName: String?
}

/// SSH sessions over the tailnet. Credentials only cross into JS when the user types a new
/// password; saved passwords and vault keys go straight from the Keychain to the Go client.
public class SapphireSshModule: Module {
  /// Output is batched for this long before crossing the bridge, so a flood (`cat` of a big file)
  /// turns into a few events per frame instead of one per read.
  static let flushInterval = DispatchTimeInterval.milliseconds(8)

  private let store = Result { try SshProfileStore(environment: .fromInfoPlist()) }
  private let vault = Result { try Vault(environment: .fromInfoPlist()) }
  private let sessions = SessionTable()

  public func definition() -> ModuleDefinition {
    Name("SapphireSsh")

    Events("onData", "onClose")

    OnDestroy {
      self.sessions.closeAll()
    }

    AsyncFunction("listProfiles") { () throws -> [[String: Any]] in
      try bridged { try self.store.get().profiles.map(serialize) }
    }

    AsyncFunction("deleteProfile") { (id: String) throws in
      try bridged { try self.store.get().delete(id: id) }
    }

    /// New credentials. Saves the profile (and password) once the server accepts them.
    AsyncFunction("connect") { (options: ConnectOptions) async throws -> [String: Any] in
      try await bridged {
        let store = try self.store.get()
        let host = normalizeHost(options.host)
        let profile = SshProfile(
          id: SshProfile.id(host: host, port: options.port, username: options.username),
          host: host, port: options.port, username: options.username,
          label: options.label.flatMap { $0.isEmpty ? nil : $0 } ?? host,
          auth: options.vaultKeyId == nil ? .password : .vaultKey,
          vaultKeyId: options.vaultKeyId, vaultKeyName: options.vaultKeyName, lastUsed: Date())

        let client: TailnetSshClient
        if let vaultKeyId = options.vaultKeyId {
          let key = try await self.vaultPrivateKey(id: vaultKeyId, prompt: "Use this SSH key")
          client = try await Self.connect(profile, password: nil, privateKey: key)
        } else {
          client = try await Self.connect(profile, password: options.password, privateKey: nil)
        }
        do {
          try store.save(profile, password: profile.auth == .password ? options.password : nil)
        } catch {
          // Still connected; it just won't be remembered.
          TailnetProxy.log("ssh: couldn't save \(profile.id): \(error.localizedDescription)")
        }
        return self.register(client, profile: profile)
      }
    }

    /// A saved profile: Face ID unlocks its password or vault key.
    AsyncFunction("connectProfile") { (id: String) async throws -> [String: Any] in
      try await bridged {
        let store = try self.store.get()
        let profile = try store.profile(id: id)
        let client: TailnetSshClient
        switch profile.auth {
        case .password:
          let password = try await Task.detached { try store.password(for: profile) }.value
          client = try await Self.connect(profile, password: password, privateKey: nil)
        case .vaultKey:
          guard let vaultKeyId = profile.vaultKeyId else { throw SshError.credentialsMissing }
          let key = try await self.vaultPrivateKey(id: vaultKeyId, prompt: "Connect to \(profile.label)")
          client = try await Self.connect(profile, password: nil, privateKey: key)
        }
        store.touch(id: id)
        return self.register(client, profile: profile)
      }
    }

    /// Starts the shell once the terminal knows its size, so nothing is drawn at the wrong width
    /// and no output arrives before JS is listening.
    AsyncFunction("startShell") { (sessionId: String, cols: Int, rows: Int) throws in
      try bridged {
        guard let session = self.sessions[sessionId] else { throw SshError.sessionNotFound }
        try session.startShell(
          cols: cols, rows: rows,
          onOutput: { [weak self] data in
            self?.sendEvent("onData", ["sessionId": sessionId, "data": data.base64EncodedString()])
          },
          onClose: { [weak self] message in
            guard let self else { return }
            self.sessions[sessionId] = nil
            var payload: [String: Any] = ["sessionId": sessionId]
            payload["message"] = message
            self.sendEvent("onClose", payload)
          })
      }
    }

    Function("write") { (sessionId: String, text: String) in
      self.sessions[sessionId]?.write(Data(text.utf8))
    }

    Function("resize") { (sessionId: String, cols: Int, rows: Int) in
      self.sessions[sessionId]?.resize(cols: cols, rows: rows)
    }

    Function("close") { (sessionId: String) in
      // onClose follows (from Go) if the shell was running; otherwise there's nothing to report.
      guard let session = self.sessions[sessionId] else { return }
      if !session.shellStarted {
        self.sessions[sessionId] = nil
      }
      session.client.close()
    }

    AsyncFunction("forgetHostKey") { (host: String, port: Int) throws in
      try bridged { try TailnetSshClient.forgetHostKey(host: normalizeHost(host), port: port) }
    }

    /// Asks before reading (iOS shows its paste prompt), so only call it for an explicit paste.
    AsyncFunction("pasteboardString") { () -> String? in
      await MainActor.run { UIPasteboard.general.string }
    }
  }

  private static func connect(_ profile: SshProfile, password: String?, privateKey: String?) async throws
    -> TailnetSshClient
  {
    try await Task.detached {
      try TailnetSshClient.connect(
        host: profile.host, port: profile.port, username: profile.username, password: password,
        privateKey: privateKey)
    }.value
  }

  private func vaultPrivateKey(id: String, prompt: String) async throws -> String {
    let vault = try vault.get()
    return try await Task.detached {
      // Read the snapshot first: no point asking for Face ID when the vault is logged out.
      let snapshot = try vault.snapshot()
      return try snapshot.sshPrivateKey(id: id, userKey: vault.userKey(prompt: prompt))
    }.value
  }

  private func register(_ client: TailnetSshClient, profile: SshProfile) -> [String: Any] {
    let id = UUID().uuidString
    sessions[id] = SshSession(client: client)
    return [
      "sessionId": id,
      "profile": serialize(profile),
      "hostKey": [
        "type": client.hostKey.type,
        "fingerprint": client.hostKey.fingerprint,
        "isNew": client.hostKey.isNew,
      ],
    ]
  }
}

/// One connection. Output is coalesced on `events`; writes and resizes run in order on `io`,
/// since a write can block while the server's window is full.
final class SshSession: @unchecked Sendable {
  let client: TailnetSshClient
  private let events = DispatchQueue(label: "dev.wuguishifu.sapphire.ssh.events")
  private let io = DispatchQueue(label: "dev.wuguishifu.sapphire.ssh.io")
  // Only touched on `events`.
  private var pending = Data()
  private var flushScheduled = false

  private let lock = NSLock()
  private var started = false

  init(client: TailnetSshClient) {
    self.client = client
  }

  var shellStarted: Bool {
    lock.withLock { started }
  }

  /// `onOutput` gets batched output; `onClose` comes once, after the last of it.
  func startShell(
    cols: Int, rows: Int, onOutput: @escaping (Data) -> Void, onClose: @escaping (String?) -> Void
  ) throws {
    lock.withLock { started = true }
    do {
      try client.startShell(
        cols: cols, rows: rows,
        onData: { [weak self] data in self?.enqueue(data, onOutput) },
        onClose: { [weak self] message in
          guard let self else { return onClose(message) }
          self.events.async {
            self.flush(onOutput)
            onClose(message)
          }
        })
    } catch {
      lock.withLock { started = false }
      throw error
    }
  }

  func write(_ data: Data) {
    io.async { [client] in
      do {
        try client.write(data)
      } catch {
        // The connection is going away; its close event says why.
        TailnetProxy.log("ssh: write failed: \(error.localizedDescription)")
      }
    }
  }

  func resize(cols: Int, rows: Int) {
    io.async { [client] in
      try? client.resize(cols: cols, rows: rows)
    }
  }

  private func enqueue(_ data: Data, _ onOutput: @escaping (Data) -> Void) {
    events.async { [self] in
      pending.append(data)
      guard !flushScheduled else { return }
      flushScheduled = true
      events.asyncAfter(deadline: .now() + SapphireSshModule.flushInterval) { [self] in
        flushScheduled = false
        flush(onOutput)
      }
    }
  }

  private func flush(_ onOutput: (Data) -> Void) {
    guard !pending.isEmpty else { return }
    let chunk = pending
    pending = Data()
    onOutput(chunk)
  }
}

final class SessionTable: @unchecked Sendable {
  private var sessions: [String: SshSession] = [:]
  private let lock = NSLock()

  subscript(id: String) -> SshSession? {
    get { lock.withLock { sessions[id] } }
    set { lock.withLock { sessions[id] = newValue } }
  }

  func closeAll() {
    let all = lock.withLock {
      defer { sessions.removeAll() }
      return Array(sessions.values)
    }
    all.forEach { $0.client.close() }
  }
}

private func serialize(_ profile: SshProfile) -> [String: Any] {
  var result: [String: Any] = [
    "id": profile.id,
    "host": profile.host,
    "port": profile.port,
    "username": profile.username,
    "label": profile.label,
    "auth": profile.auth.rawValue,
  ]
  result["vaultKeyId"] = profile.vaultKeyId
  result["vaultKeyName"] = profile.vaultKeyName
  result["lastUsed"] = profile.lastUsed.map { $0.timeIntervalSince1970 * 1000 }
  return result
}

/// Turns failures into exceptions whose `code` JS can switch on.
private func bridged<T>(_ body: () throws -> T) throws -> T {
  do {
    return try body()
  } catch {
    throw SshException(SshError(error))
  }
}

private func bridged<T>(_ body: () async throws -> T) async throws -> T {
  do {
    return try await body()
  } catch {
    throw SshException(SshError(error))
  }
}

final class SshException: Exception, @unchecked Sendable {
  init(_ error: SshError) {
    super.init(name: "SshError", description: error.localizedDescription, code: error.code)
  }

  override var reason: String {
    description
  }
}
