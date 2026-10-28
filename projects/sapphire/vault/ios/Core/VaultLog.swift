import Foundation

/// Diagnostic lines about requests and syncs. The app points `sink` at the tailnet's log buffer;
/// the extension leaves it unset. Never log secrets or tokens.
public enum VaultLog {
  public static var sink: ((String) -> Void)?

  static func log(_ message: String) {
    sink?("vault: \(message)")
  }
}

extension ContinuousClock.Instant {
  /// Time since this instant, as "812ms".
  var elapsed: String {
    let (seconds, attoseconds) = (ContinuousClock.now - self).components
    return "\(seconds * 1000 + attoseconds / 1_000_000_000_000_000)ms"
  }
}
