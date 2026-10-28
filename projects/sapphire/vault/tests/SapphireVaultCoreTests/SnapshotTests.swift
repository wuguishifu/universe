import XCTest

@testable import SapphireVaultCore

/// A synthetic sync response, encrypted with our own `EncString.encrypt`.
final class SnapshotTests: XCTestCase {
  let userKey = VaultKey.random()

  func enc(_ value: String, _ key: VaultKey? = nil) throws -> String {
    try EncString.encrypt(Data(value.utf8), with: key ?? userKey).string
  }

  func makeSync() throws -> Data {
    let itemKey = VaultKey.random()
    let ciphers: [[String: Any]] = [
      [
        "id": "plain", "type": 1, "organizationId": NSNull(), "deletedDate": NSNull(), "key": NSNull(),
        "favorite": true, "name": try enc("Plain"),
        "login": [
          "username": try enc("alice"), "password": try enc("hunter2"), "totp": try enc("JBSWY3DPEHPK3PXP"),
          "uris": [["uri": try enc("https://example.com"), "match": NSNull()], ["uri": try enc("https://x.org"), "match": 3]],
        ],
      ],
      [
        // Encrypted with its own item key, which is wrapped with the user key.
        "id": "item-key", "type": 1, "key": try EncString.encrypt(itemKey.data, with: userKey).string,
        "favorite": false, "name": try enc("Item Key", itemKey),
        "login": ["username": NSNull(), "password": try enc("p2", itemKey), "totp": NSNull(), "uris": NSNull()],
      ],
      // PascalCase, as older Vaultwarden versions send.
      [
        "Id": "pascal", "Type": 1, "Name": try enc("Pascal"),
        "Login": ["Username": try enc("bob"), "Password": try enc("p3")],
      ],
      ["id": "org", "type": 1, "organizationId": "o1", "name": try enc("Org"), "login": [:]],
      ["id": "deleted", "type": 1, "deletedDate": "2026-01-01T00:00:00Z", "name": try enc("Deleted"), "login": [:]],
      ["id": "note", "type": 2, "name": try enc("Note"), "secureNote": ["type": 0]],
      // Corrupt items are skipped rather than failing the whole vault.
      ["id": "corrupt", "type": 1, "name": try enc("Corrupt", .random()), "login": [:]],
    ]
    return try JSONSerialization.data(withJSONObject: ["object": "sync", "ciphers": ciphers])
  }

  func testSummaries() throws {
    let snapshot = try VaultSnapshot(syncResponse: makeSync())
    XCTAssertEqual(snapshot.count, 4)

    let summaries = try snapshot.summaries(userKey: userKey)
    XCTAssertEqual(summaries.map(\.id), ["plain", "item-key", "pascal"])
    XCTAssertEqual(
      summaries[0],
      VaultItemSummary(
        id: "plain", name: "Plain", username: "alice",
        uris: [LoginUri(uri: "https://example.com", match: nil), LoginUri(uri: "https://x.org", match: .exact)],
        favorite: true, hasTotp: true))
    XCTAssertEqual(summaries[1].name, "Item Key")
    XCTAssertNil(summaries[1].username)
    XCTAssertEqual(summaries[2].username, "bob")
  }

  func testSecrets() throws {
    let snapshot = try VaultSnapshot(syncResponse: makeSync())
    XCTAssertEqual(
      try snapshot.secret(id: "plain", userKey: userKey),
      VaultItemSecret(password: "hunter2", totp: "JBSWY3DPEHPK3PXP"))
    XCTAssertEqual(try snapshot.secret(id: "item-key", userKey: userKey), VaultItemSecret(password: "p2", totp: nil))
    XCTAssertThrowsError(try snapshot.secret(id: "org", userKey: userKey)) {
      XCTAssertEqual($0 as? VaultError, .itemNotFound)
    }
  }

  func testWrongUserKeyFailsLoudly() throws {
    let snapshot = try VaultSnapshot(syncResponse: makeSync())
    XCTAssertThrowsError(try snapshot.summaries(userKey: .random())) {
      XCTAssertEqual($0 as? VaultError, .decryptionFailed)
    }
  }

  func testInvalidResponse() {
    XCTAssertThrowsError(try VaultSnapshot(syncResponse: Data("{}".utf8)))
    XCTAssertThrowsError(try VaultSnapshot(syncResponse: Data("nope".utf8)))
  }
}

final class EnvironmentTests: XCTestCase {
  func testKeepsExpandedTeamPrefix() throws {
    XCTAssertEqual(
      try VaultEnvironment.withTeamPrefix("7C3LJCLXTY.dev.wuguishifu.sapphire.shared"),
      "7C3LJCLXTY.dev.wuguishifu.sapphire.shared")
  }
}
