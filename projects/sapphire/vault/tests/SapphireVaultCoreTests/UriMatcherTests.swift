import XCTest

@testable import SapphireVaultCore

final class UriMatcherTests: XCTestCase {
  func testBaseDomains() {
    let psl = PublicSuffixList.shared
    let cases: [(String, String?)] = [
      ("github.com", "github.com"),
      ("api.github.com", "github.com"),
      ("www.example.co.uk", "example.co.uk"),
      ("co.uk", nil),
      ("uk", nil),
      ("Example.COM.", "example.com"),
      // `*.kawasaki.jp` with the `!city.kawasaki.jp` exception.
      ("foo.bar.kawasaki.jp", "foo.bar.kawasaki.jp"),
      ("bar.kawasaki.jp", nil),
      ("www.city.kawasaki.jp", "city.kawasaki.jp"),
      // Private section entries aren't suffixes, matching Bitwarden.
      ("someone.github.io", "github.io"),
      // Unknown TLDs fall back to the implicit `*` rule.
      ("sol.internal", "sol.internal"),
      ("sol", nil),
      ("localhost", "localhost"),
      ("192.168.1.10", "192.168.1.10"),
      ("100.101.102.103", "100.101.102.103"),
    ]
    for (host, expected) in cases {
      XCTAssertEqual(psl.baseDomain(of: host), expected, host)
    }
  }

  func testMatchTable() {
    let cases: [(uri: String, match: UriMatchType?, target: String, expected: Bool)] = [
      // Base domain (the default).
      ("https://github.com", nil, "https://github.com/login", true),
      ("https://github.com", nil, "https://gist.github.com", true),
      ("github.com", nil, "https://github.com", true),
      ("https://github.com", .domain, "https://github.io", false),
      ("https://example.co.uk", nil, "https://other.co.uk", false),
      ("https://accounts.google.com", nil, "https://mail.google.com", true),
      ("https://accounts.google.com", nil, "https://script.google.com", false),
      ("https://192.168.1.10:8080", nil, "http://192.168.1.10/", true),
      ("http://sol:8080", nil, "http://sol:8080", false),
      ("not a uri", nil, "https://github.com", false),
      // Host, port included.
      ("https://login.example.co.uk:8443", .host, "https://login.example.co.uk:8443/x", true),
      ("https://login.example.co.uk:8443", .host, "https://login.example.co.uk/x", false),
      ("https://login.example.co.uk", .host, "https://www.example.co.uk", false),
      // Starts with and exact.
      ("https://unicode.example.com/a", .startsWith, "https://unicode.example.com/abc", true),
      ("https://unicode.example.com/a", .startsWith, "https://unicode.example.com/b", false),
      ("https://example.org/login", .exact, "https://example.org/login", true),
      ("https://example.org/login", .exact, "https://example.org/login?next=/", false),
      // Regular expression, case-insensitive like Bitwarden's `new RegExp(uri, "i")`.
      ("^https://(www\\.)?Example\\.com/", .regularExpression, "https://www.example.com/x", true),
      ("^https://example\\.com/$", .regularExpression, "https://example.com/x", false),
      ("([unclosed", .regularExpression, "https://example.com", false),
      // Never.
      ("https://github.com", .never, "https://github.com", false),
    ]
    for c in cases {
      XCTAssertEqual(
        UriMatcher.matches(LoginUri(uri: c.uri, match: c.match), target: c.target), c.expected,
        "\(c.uri) (\(String(describing: c.match))) vs \(c.target)")
    }
  }

  func testCredentialServices() {
    let summary = VaultItemSummary(
      id: "1", name: "x", username: "u",
      uris: [
        LoginUri(uri: "https://www.github.com/login", match: nil),
        LoginUri(uri: "https://api.github.com", match: .domain),
        LoginUri(uri: "https://login.example.co.uk:8443", match: .host),
        LoginUri(uri: "https://example.org/login", match: .exact),
        LoginUri(uri: "^https://", match: .regularExpression),
        LoginUri(uri: "https://never.example", match: .never),
      ],
      favorite: false, hasTotp: false)

    XCTAssertEqual(
      CredentialIdentities.services(for: summary),
      [
        .init(identifier: "github.com", type: .domain),
        .init(identifier: "login.example.co.uk", type: .domain),
        .init(identifier: "https://example.org/login", type: .URL),
      ])
  }
}
