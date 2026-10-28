import Foundation

/// Bitwarden's per-URI "match detection" setting.
public enum UriMatchType: Int {
  case domain = 0
  case host = 1
  case startsWith = 2
  case exact = 3
  case regularExpression = 4
  case never = 5
}

public struct LoginUri: Equatable {
  public let uri: String
  /// nil means the account default, which is base domain.
  public let match: UriMatchType?

  public init(uri: String, match: UriMatchType?) {
    self.uri = uri
    self.match = match
  }
}

/// Ports Bitwarden's `LoginUriView.matchesUri`, minus equivalent domains (we sync with
/// `excludeDomains=true`).
public enum UriMatcher {
  /// Hosts that share a base domain but shouldn't fill each other's logins.
  static let domainMatchBlacklist: [String: Set<String>] = ["google.com": ["script.google.com"]]

  public static func matches(
    _ loginUri: LoginUri, target: String, suffixes: PublicSuffixList = .shared
  ) -> Bool {
    switch loginUri.match ?? .domain {
    case .domain:
      guard let targetHost = hostname(of: target),
        let targetDomain = suffixes.baseDomain(of: targetHost),
        let itemHost = hostname(of: loginUri.uri),
        let itemDomain = suffixes.baseDomain(of: itemHost),
        itemDomain == targetDomain
      else { return false }
      return !(domainMatchBlacklist[itemDomain]?.contains(targetHost) ?? false)
    case .host:
      guard let targetHost = hostWithPort(of: target) else { return false }
      return targetHost == hostWithPort(of: loginUri.uri)
    case .startsWith:
      return target.hasPrefix(loginUri.uri)
    case .exact:
      return target == loginUri.uri
    case .regularExpression:
      guard let regex = try? NSRegularExpression(pattern: loginUri.uri, options: .caseInsensitive) else {
        return false
      }
      return regex.firstMatch(in: target, range: NSRange(target.startIndex..., in: target)) != nil
    case .never:
      return false
    }
  }

  /// Bitwarden treats a scheme-less value with a dot in it (`example.com`) as `http://`.
  static func url(from string: String) -> URLComponents? {
    let trimmed = string.trimmingCharacters(in: .whitespaces)
    if trimmed.contains("://") {
      return URLComponents(string: trimmed)
    }
    guard trimmed.contains(".") else { return nil }
    return URLComponents(string: "http://" + trimmed)
  }

  public static func hostname(of string: String) -> String? {
    guard let host = url(from: string)?.host, !host.isEmpty else { return nil }
    return host.lowercased()
  }

  static func hostWithPort(of string: String) -> String? {
    guard let components = url(from: string), let host = components.host, !host.isEmpty else {
      return nil
    }
    return components.port.map { "\(host.lowercased()):\($0)" } ?? host.lowercased()
  }
}
