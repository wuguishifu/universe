import Foundation

/// Base-domain lookup against the bundled ICANN section of the public suffix list, matching
/// what Bitwarden's clients (tldts) compute for "base domain" URI matching.
public final class PublicSuffixList {
  public static let shared: PublicSuffixList = {
    guard let url = resourceBundle.url(forResource: "public_suffix_list", withExtension: "dat"),
      let contents = try? String(contentsOf: url, encoding: .utf8)
    else {
      // Without the list every host falls back to the implicit `*` rule (last label).
      return PublicSuffixList(rules: "")
    }
    return PublicSuffixList(rules: contents)
  }()

  private var rules: Set<String> = []
  private var wildcards: Set<String> = []
  private var exceptions: Set<String> = []

  public init(rules contents: String) {
    for line in contents.split(whereSeparator: \.isNewline) {
      let rule = line.trimmingCharacters(in: .whitespaces).lowercased()
      if rule.isEmpty || rule.hasPrefix("//") {
        continue
      }
      if rule.hasPrefix("!") {
        exceptions.insert(String(rule.dropFirst()))
      } else if rule.hasPrefix("*.") {
        wildcards.insert(String(rule.dropFirst(2)))
      } else {
        rules.insert(rule)
      }
    }
  }

  /// The public suffix of `host` (e.g. `co.uk` for `www.example.co.uk`).
  public func publicSuffix(of host: String) -> String {
    let labels = host.split(separator: ".").map(String.init)
    for start in labels.indices {
      let candidate = labels[start...].joined(separator: ".")
      if exceptions.contains(candidate) {
        return labels[(start + 1)...].joined(separator: ".")
      }
      let parent = labels[(start + 1)...].joined(separator: ".")
      if rules.contains(candidate) || (start + 1 < labels.count && wildcards.contains(parent)) {
        return candidate
      }
    }
    return labels.last ?? host
  }

  /// The registrable domain (public suffix plus one label), or nil for a bare public suffix or a
  /// single-label host. IPs and `localhost` are their own base domain, as in Bitwarden.
  public func baseDomain(of host: String) -> String? {
    var host = host.lowercased()
    if host.hasSuffix(".") {
      host.removeLast()
    }
    if host.isEmpty {
      return nil
    }
    if host == "localhost" || isIPAddress(host) {
      return host
    }

    let suffix = publicSuffix(of: host)
    guard host.count > suffix.count else { return nil }
    let rest = host.dropLast(suffix.count + 1)
    guard let label = rest.split(separator: ".").last else { return nil }
    return "\(label).\(suffix)"
  }
}

func isIPAddress(_ host: String) -> Bool {
  var host = host
  if host.hasPrefix("[") && host.hasSuffix("]") {
    host = String(host.dropFirst().dropLast())
  }
  var v4 = in_addr()
  var v6 = in6_addr()
  return inet_pton(AF_INET, host, &v4) == 1 || inet_pton(AF_INET6, host, &v6) == 1
}

private final class BundleToken {}

let resourceBundle: Bundle = {
  #if SWIFT_PACKAGE
    return Bundle.module
  #else
    // CocoaPods copies the resource bundle next to the code (the app or the extension).
    let host = Bundle(for: BundleToken.self)
    return host.url(forResource: "SapphireVaultCore", withExtension: "bundle").flatMap(Bundle.init(url:)) ?? host
  #endif
}()
