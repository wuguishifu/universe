import XCTest

@testable import SapphireVaultCore

/// Runs the whole read path against real Vaultwarden responses for the throwaway account,
/// captured by `scripts/capture-fixtures.mjs`. `expected.json` lists the items the account was
/// set up with (see the README).
final class FixtureTests: XCTestCase {
  struct Account: Decodable {
    let email: String
    let masterPassword: String
  }

  struct ExpectedItem: Decodable {
    struct Uri: Decodable {
      let uri: String
      let match: Int?
    }

    let name: String
    let username: String?
    let password: String?
    let uris: [Uri]
    let totp: String?
    let favorite: Bool
  }

  func fixture(_ name: String) throws -> Data {
    let url = Bundle.module.url(forResource: "Fixtures", withExtension: nil)!.appending(path: name)
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw XCTSkip("\(name) hasn't been captured yet; run `nx run sapphire-vault:capture-fixtures`")
    }
    return try Data(contentsOf: url)
  }

  func userKey() throws -> VaultKey {
    let account = try JSONDecoder().decode(Account.self, from: fixture("account.json"))
    let prelogin = try JSONSerialization.jsonObject(with: fixture("prelogin.json")) as! [String: Any]
    let token = try JSONSerialization.jsonObject(with: fixture("token.json")) as! [String: Any]

    XCTAssertEqual(prelogin.field("kdf") as? Int, 0)
    let iterations = try XCTUnwrap(prelogin.field("kdfIterations") as? Int)
    let masterKey = try KeyDerivation.masterKey(
      password: account.masterPassword, email: account.email, iterations: iterations)
    // The MAC on the wrapped user key only verifies if the whole derivation chain is right.
    return try KeyDerivation.userKey(encrypted: XCTUnwrap(token.field("Key") as? String), masterKey: masterKey)
  }

  func testMasterPasswordHashMatchesWhatTheServerAccepted() throws {
    let account = try JSONDecoder().decode(Account.self, from: fixture("account.json"))
    let capture = try JSONSerialization.jsonObject(with: fixture("prelogin.json")) as! [String: Any]
    let masterKey = try KeyDerivation.masterKey(
      password: account.masterPassword, email: account.email,
      iterations: XCTUnwrap(capture.field("kdfIterations") as? Int))
    let hash = try KeyDerivation.masterPasswordHash(masterKey: masterKey, password: account.masterPassword)
    // The capture script logs in with its own (Node) hash and records it.
    let recorded = try String(data: fixture("master-password-hash.txt"), encoding: .utf8)!
    XCTAssertEqual(hash, recorded.trimmingCharacters(in: .whitespacesAndNewlines))
  }

  func testDecryptsTheVault() throws {
    let key = try userKey()
    let snapshot = try VaultSnapshot(syncResponse: fixture("sync.json"))
    let expected = try JSONDecoder().decode([ExpectedItem].self, from: fixture("expected.json"))

    let summaries = try snapshot.summaries(userKey: key)
    XCTAssertEqual(
      summaries.map(\.name).sorted(), expected.map(\.name).sorted(),
      "the note and the trashed item should be filtered out")

    for item in expected {
      let summary = try XCTUnwrap(summaries.first { $0.name == item.name }, item.name)
      XCTAssertEqual(summary.username, item.username, item.name)
      XCTAssertEqual(summary.favorite, item.favorite, item.name)
      XCTAssertEqual(summary.hasTotp, item.totp != nil, item.name)
      XCTAssertEqual(
        summary.uris, item.uris.map { LoginUri(uri: $0.uri, match: $0.match.flatMap(UriMatchType.init(rawValue:))) },
        item.name)

      let secret = try snapshot.secret(id: summary.id, userKey: key)
      XCTAssertEqual(secret.password, item.password, item.name)
      XCTAssertEqual(secret.totp, item.totp, item.name)
      if let totp = secret.totp {
        XCTAssertNoThrow(try Totp(totp), item.name)
      }
    }
  }
}
