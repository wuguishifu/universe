import XCTest

@testable import SapphireVaultCore

final class CryptoTests: XCTestCase {
  // Vectors computed independently with Node's crypto (PBKDF2, and HKDF-Expand's single block
  // as HMAC-SHA256(masterKey, info || 0x01)).
  func testKeyDerivation() throws {
    let password = "correct horse battery staple"
    let masterKey = try KeyDerivation.masterKey(password: password, email: "Test@Example.com ", iterations: 5000)
    XCTAssertEqual(masterKey.base64EncodedString(), "KlhutQU5KY4mHYKrHTCgbvWRRsMvb9NaKgHq/b/jpCs=")

    XCTAssertEqual(
      try KeyDerivation.masterPasswordHash(masterKey: masterKey, password: password),
      "Xwzh3+4pKwKitTxpO4t5gBqy8l7+pIJ3EZLA/KGs7Ps=")

    let stretched = KeyDerivation.stretch(masterKey: masterKey)
    XCTAssertEqual(stretched.encKey.base64EncodedString(), "UbWA2ZO5pmyFUH2iT1+Fm0VKSwQdXwkCa9FQWST4BiM=")
    XCTAssertEqual(stretched.macKey?.base64EncodedString(), "YAOry+x9nxpdItKGvlZ1lJNu7pbuZq/qlvdKgEDsSwU=")
  }

  // Encrypted with Node: key bytes 0...63, IV of 0x07s.
  func testDecryptsExternalEncString() throws {
    let key = try VaultKey(data: Data((0..<64).map { UInt8($0) }))
    let encString = try EncString(
      "2.BwcHBwcHBwcHBwcHBwcHBw==|aF1X99vHt1H9r5cf6tRP7Q==|vlxRxRranoYZZJm+2kEw6jRBbvfP0ijciZ7lDShDqBU=")
    XCTAssertEqual(try encString.decryptString(with: key), "hello vault ✓")
  }

  func testDecryptsLegacyType0() throws {
    let key = try VaultKey(data: Data((0..<32).map { UInt8($0) }))
    let encString = try EncString("0.BwcHBwcHBwcHBwcHBwcHBw==|9oyceF2JjMfunZrxhyv9pQ==")
    XCTAssertEqual(encString.type, .aesCbc256)
    XCTAssertEqual(try encString.decryptString(with: key), "legacy")
  }

  func testRoundTrip() throws {
    let key = VaultKey.random()
    let encrypted = try EncString.encrypt(Data("pässwörd-✓".utf8), with: key)
    XCTAssertTrue(encrypted.string.hasPrefix("2."))

    let parsed = try EncString(encrypted.string)
    XCTAssertEqual(parsed, encrypted)
    XCTAssertEqual(try parsed.decryptString(with: key), "pässwörd-✓")
  }

  func testRejectsTamperingAndWrongKeys() throws {
    let key = VaultKey.random()
    let encrypted = try EncString.encrypt(Data("secret".utf8), with: key)

    XCTAssertThrowsError(try encrypted.decrypt(with: .random())) {
      XCTAssertEqual($0 as? VaultError, .macMismatch)
    }

    var ciphertext = encrypted.ciphertext
    ciphertext[ciphertext.startIndex] ^= 0x01
    let tampered = EncString(type: encrypted.type, iv: encrypted.iv, ciphertext: ciphertext, mac: encrypted.mac)
    XCTAssertThrowsError(try tampered.decrypt(with: key)) {
      XCTAssertEqual($0 as? VaultError, .macMismatch)
    }
  }

  func testParsing() {
    XCTAssertThrowsError(try EncString("2.onlyonepart"))
    XCTAssertThrowsError(try EncString("9.a|b|c")) {
      XCTAssertEqual($0 as? VaultError, .unsupportedEncryptionType(9))
    }
    XCTAssertThrowsError(try EncString("2.!!|!!|!!"))
    // Headerless with three parts is the long-dead AES-128 type.
    XCTAssertThrowsError(try EncString("AAAA|AAAA|AAAA")) {
      XCTAssertEqual($0 as? VaultError, .unsupportedEncryptionType(1))
    }
  }

  func testUserKeyUnwrap() throws {
    let masterKey = try KeyDerivation.masterKey(password: "pw", email: "a@b.c", iterations: 1000)
    let userKey = VaultKey.random()
    let wrapped = try EncString.encrypt(userKey.data, with: KeyDerivation.stretch(masterKey: masterKey))

    XCTAssertEqual(try KeyDerivation.userKey(encrypted: wrapped.string, masterKey: masterKey), userKey)

    let otherMasterKey = try KeyDerivation.masterKey(password: "wrong", email: "a@b.c", iterations: 1000)
    XCTAssertThrowsError(try KeyDerivation.userKey(encrypted: wrapped.string, masterKey: otherMasterKey))
  }
}
