import XCTest

@testable import SapphireVaultCore

final class TotpTests: XCTestCase {
  /// RFC 6238 appendix B.
  func testRfc6238Vectors() {
    let sha1 = Totp(secret: Data("12345678901234567890".utf8), algorithm: .sha1, digits: 8)
    let sha256 = Totp(secret: Data("12345678901234567890123456789012".utf8), algorithm: .sha256, digits: 8)
    let sha512 = Totp(
      secret: Data("1234567890123456789012345678901234567890123456789012345678901234".utf8),
      algorithm: .sha512, digits: 8)

    let vectors: [(TimeInterval, String, String, String)] = [
      (59, "94287082", "46119246", "90693936"),
      (1_111_111_109, "07081804", "68084774", "25091201"),
      (1_111_111_111, "14050471", "67062674", "99943326"),
      (1_234_567_890, "89005924", "91819424", "93441116"),
      (2_000_000_000, "69279037", "90698825", "38618901"),
      (20_000_000_000, "65353130", "77737706", "47863826"),
    ]
    for (time, expected1, expected256, expected512) in vectors {
      let date = Date(timeIntervalSince1970: time)
      XCTAssertEqual(sha1.code(at: date), expected1, "SHA1 at \(time)")
      XCTAssertEqual(sha256.code(at: date), expected256, "SHA256 at \(time)")
      XCTAssertEqual(sha512.code(at: date), expected512, "SHA512 at \(time)")
    }
  }

  func testBareSecret() throws {
    let totp = try Totp("jbsw y3dp ehpk 3pxp")
    XCTAssertEqual(totp.secret, Data("Hello!".utf8) + Data([0xde, 0xad, 0xbe, 0xef]))
    XCTAssertEqual(totp.algorithm, .sha1)
    XCTAssertEqual(totp.digits, 6)
    XCTAssertEqual(totp.period, 30)
    XCTAssertEqual(totp.code(at: Date(timeIntervalSince1970: 59)).count, 6)
  }

  func testOtpauthUri() throws {
    let totp = try Totp(
      "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example&digits=8&period=60&algorithm=sha256")
    XCTAssertEqual(totp.algorithm, .sha256)
    XCTAssertEqual(totp.digits, 8)
    XCTAssertEqual(totp.period, 60)
    XCTAssertEqual(totp.remaining(at: Date(timeIntervalSince1970: 61)), 59)

    let defaults = try Totp("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=99&period=-1")
    XCTAssertEqual(defaults.digits, 6)
    XCTAssertEqual(defaults.period, 30)

    XCTAssertThrowsError(try Totp("otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP"))
    XCTAssertThrowsError(try Totp("otpauth://totp/x?issuer=nosecret"))
  }

  func testSteam() throws {
    let totp = try Totp("steam://JBSWY3DPEHPK3PXP")
    XCTAssertTrue(totp.steam)
    let code = totp.code(at: Date(timeIntervalSince1970: 1_234_567_890))
    XCTAssertEqual(code.count, 5)
    XCTAssertTrue(code.allSatisfy { "23456789BCDFGHJKMNPQRTVWXY".contains($0) })
  }

  func testInvalidSecrets() {
    XCTAssertThrowsError(try Totp("not base32!"))
    XCTAssertThrowsError(try Totp(""))
  }
}
