import Foundation
import Sapphireproxy

/// An error from the Go SSH client. `code` is one of the `ERR_SSH_*` codes in `ssh.go`.
public struct TailnetSshError: Error, LocalizedError {
  public let code: String
  public let message: String

  public var errorDescription: String? { message }

  /// Go only hands over a message, so the code travels as its prefix ("ERR_SSH_AUTH_FAILED: …").
  init(_ error: Error) {
    let text = (error as NSError).localizedDescription
    if let prefix = text.range(of: #"^ERR_SSH_[A-Z_]+: "#, options: .regularExpression) {
      code = String(text[prefix].dropLast(2))
      message = String(text[prefix.upperBound...])
    } else {
      code = "ERR_SSH"
      message = text
    }
  }
}

/// An SSH connection over the embedded tailnet node, so MagicDNS names and 100.x IPs work
/// without the VPN. Host keys are trusted on first use and remembered next to the node state.
public final class TailnetSshClient: @unchecked Sendable {
  public struct HostKey {
    public let type: String
    /// `SHA256:…`, like `ssh-keygen -l`.
    public let fingerprint: String
    /// This connection trusted the key for the first time.
    public let isNew: Bool
  }

  private let client: SapphireproxySSHClient
  public let hostKey: HostKey

  private init(client: SapphireproxySSHClient) {
    self.client = client
    hostKey = HostKey(type: client.hostKeyType(), fingerprint: client.hostKeyFingerprint(), isNew: client.hostKeyIsNew())
  }

  /// Dials and authenticates with a password or an OpenSSH/PEM private key. Blocks for the
  /// handshake (up to 20s), so call it off the main thread.
  public static func connect(
    host: String, port: Int, username: String, password: String?, privateKey: String?
  ) throws -> TailnetSshClient {
    var error: NSError?
    let client = SapphireproxySSHConnect(host, port, username, password ?? "", privateKey ?? "", &error)
    if let error {
      throw TailnetSshError(error)
    }
    guard let client else {
      throw TailnetSshError(NSError(domain: "go", code: 0, userInfo: [NSLocalizedDescriptionKey: "no client"]))
    }
    return TailnetSshClient(client: client)
  }

  /// Drops the remembered host key, so the next connection trusts whatever the server presents.
  public static func forgetHostKey(host: String, port: Int) throws {
    var error: NSError?
    SapphireproxySSHForgetHostKey(host, port, &error)
    if let error {
      throw TailnetSshError(error)
    }
  }

  /// Starts the login shell in a cols x rows PTY. `onData` is called on a background thread for
  /// each chunk of output; `onClose` once after the last, with nil for a clean exit.
  public func startShell(
    cols: Int, rows: Int, onData: @escaping (Data) -> Void, onClose: @escaping (String?) -> Void
  ) throws {
    do {
      try client.startShell(cols, rows: rows, listener: Listener(onData: onData, onClose: onClose))
    } catch {
      throw TailnetSshError(error)
    }
  }

  /// Blocks while the server's receive window is full; call it off the main thread.
  public func write(_ data: Data) throws {
    do {
      try client.write(data)
    } catch {
      throw TailnetSshError(error)
    }
  }

  public func resize(cols: Int, rows: Int) throws {
    do {
      try client.resize(cols, rows: rows)
    } catch {
      throw TailnetSshError(error)
    }
  }

  public func close() {
    client.close()
  }
}

private final class Listener: NSObject, SapphireproxySSHListenerProtocol {
  let onDataHandler: (Data) -> Void
  let onCloseHandler: (String?) -> Void

  init(onData: @escaping (Data) -> Void, onClose: @escaping (String?) -> Void) {
    onDataHandler = onData
    onCloseHandler = onClose
  }

  func onData(_ data: Data?) {
    // Copy: the bytes may only be valid for the duration of the call.
    if let data {
      onDataHandler(Data(data))
    }
  }

  func onClose(_ message: String?) {
    onCloseHandler(message.flatMap { $0.isEmpty ? nil : $0 })
  }
}
