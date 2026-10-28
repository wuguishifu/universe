import CommonCrypto
import CryptoKit
import Foundation

/// A Bitwarden symmetric key: a 32-byte AES-256 key and, for every key in use today, a 32-byte
/// HMAC-SHA256 key. Serialized as the two concatenated (64 bytes).
public struct VaultKey: Equatable {
  public let encKey: Data
  public let macKey: Data?

  public init(encKey: Data, macKey: Data?) {
    self.encKey = encKey
    self.macKey = macKey
  }

  public init(data: Data) throws {
    switch data.count {
    case 64:
      self.init(encKey: Data(data.prefix(32)), macKey: Data(data.suffix(32)))
    case 32:
      self.init(encKey: data, macKey: nil)
    default:
      throw VaultError.decryptionFailed
    }
  }

  public var data: Data {
    encKey + (macKey ?? Data())
  }

  public static func random() -> VaultKey {
    VaultKey(encKey: randomBytes(32), macKey: randomBytes(32))
  }
}

/// Bitwarden's `EncString`: `<type>.<iv>|<ciphertext>|<mac>`, each part base64.
///
/// Only the two AES-CBC-256 types show up in a personal vault: 2 (with HMAC-SHA256, everything
/// current) and 0 (no MAC, very old accounts' user keys).
public struct EncString: Equatable {
  public enum EncryptionType: Int {
    case aesCbc256 = 0
    case aesCbc256HmacSha256 = 2
  }

  public let type: EncryptionType
  public let iv: Data
  public let ciphertext: Data
  public let mac: Data?

  public init(_ string: String) throws {
    let typeValue: Int
    let body: Substring
    if let dot = string.firstIndex(of: ".") {
      guard let parsed = Int(string[..<dot]) else { throw VaultError.invalidEncString }
      typeValue = parsed
      body = string[string.index(after: dot)...]
    } else {
      // Headerless strings predate the type prefix: two parts means AES-CBC-256 without a MAC.
      body = Substring(string)
      typeValue = body.split(separator: "|").count == 3 ? 1 : 0
    }
    guard let type = EncryptionType(rawValue: typeValue) else {
      throw VaultError.unsupportedEncryptionType(typeValue)
    }

    let parts = body.split(separator: "|", omittingEmptySubsequences: false).map {
      Data(base64Encoded: String($0))
    }
    switch (type, parts.count) {
    case (.aesCbc256HmacSha256, 3):
      guard let iv = parts[0], let ciphertext = parts[1], let mac = parts[2] else {
        throw VaultError.invalidEncString
      }
      self.init(type: type, iv: iv, ciphertext: ciphertext, mac: mac)
    case (.aesCbc256, 2):
      guard let iv = parts[0], let ciphertext = parts[1] else { throw VaultError.invalidEncString }
      self.init(type: type, iv: iv, ciphertext: ciphertext, mac: nil)
    default:
      throw VaultError.invalidEncString
    }
  }

  init(type: EncryptionType, iv: Data, ciphertext: Data, mac: Data?) {
    self.type = type
    self.iv = iv
    self.ciphertext = ciphertext
    self.mac = mac
  }

  public var string: String {
    let parts = [iv, ciphertext] + (mac.map { [$0] } ?? [])
    return "\(type.rawValue)." + parts.map { $0.base64EncodedString() }.joined(separator: "|")
  }

  public func decrypt(with key: VaultKey) throws -> Data {
    switch type {
    case .aesCbc256HmacSha256:
      guard let macKey = key.macKey, let mac else { throw VaultError.macMismatch }
      let valid = HMAC<SHA256>.isValidAuthenticationCode(
        mac, authenticating: iv + ciphertext, using: SymmetricKey(data: macKey))
      guard valid else { throw VaultError.macMismatch }
    case .aesCbc256:
      guard key.macKey == nil else { throw VaultError.macMismatch }
    }
    return try aesCbc(CCOperation(kCCDecrypt), key: key.encKey, iv: iv, input: ciphertext)
  }

  public func decryptString(with key: VaultKey) throws -> String {
    guard let string = String(data: try decrypt(with: key), encoding: .utf8) else {
      throw VaultError.decryptionFailed
    }
    return string
  }

  /// Always produces type 2. Kept for adding items later; tested by round trip.
  public static func encrypt(_ plaintext: Data, with key: VaultKey) throws -> EncString {
    guard let macKey = key.macKey else { throw VaultError.unsupportedEncryptionType(0) }
    let iv = randomBytes(16)
    let ciphertext = try aesCbc(CCOperation(kCCEncrypt), key: key.encKey, iv: iv, input: plaintext)
    let mac = Data(HMAC<SHA256>.authenticationCode(for: iv + ciphertext, using: SymmetricKey(data: macKey)))
    return EncString(type: .aesCbc256HmacSha256, iv: iv, ciphertext: ciphertext, mac: mac)
  }
}

public enum KeyDerivation {
  /// The master key: PBKDF2-SHA256 over the master password, salted with the lowercased email.
  public static func masterKey(password: String, email: String, iterations: Int) throws -> Data {
    let salt = Data(email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().utf8)
    return try pbkdf2(password: Data(password.utf8), salt: salt, iterations: iterations)
  }

  /// What the server checks at login: one more PBKDF2 round over the master key, salted with
  /// the password.
  public static func masterPasswordHash(masterKey: Data, password: String) throws -> String {
    try pbkdf2(password: masterKey, salt: Data(password.utf8), iterations: 1).base64EncodedString()
  }

  /// The key that wraps the user key: the master key expanded with HKDF into separate AES and
  /// HMAC keys.
  public static func stretch(masterKey: Data) -> VaultKey {
    func expand(_ info: String) -> Data {
      HKDF<SHA256>.expand(
        pseudoRandomKey: SymmetricKey(data: masterKey), info: Data(info.utf8), outputByteCount: 32
      ).withUnsafeBytes { Data($0) }
    }
    return VaultKey(encKey: expand("enc"), macKey: expand("mac"))
  }

  /// Unwraps the user key the server returns at login (`Key`) with the master key.
  public static func userKey(encrypted: String, masterKey: Data) throws -> VaultKey {
    let encString = try EncString(encrypted)
    let wrappingKey =
      switch encString.type {
      case .aesCbc256HmacSha256: stretch(masterKey: masterKey)
      // Accounts created before key stretching wrapped the user key with the bare master key.
      case .aesCbc256: VaultKey(encKey: masterKey, macKey: nil)
      }
    return try VaultKey(data: encString.decrypt(with: wrappingKey))
  }
}

func pbkdf2(password: Data, salt: Data, iterations: Int) throws -> Data {
  var derived = Data(count: 32)
  let status = derived.withUnsafeMutableBytes { derivedBytes in
    password.withUnsafeBytes { passwordBytes in
      salt.withUnsafeBytes { saltBytes in
        CCKeyDerivationPBKDF(
          CCPBKDFAlgorithm(kCCPBKDF2),
          passwordBytes.baseAddress?.assumingMemoryBound(to: CChar.self), password.count,
          saltBytes.baseAddress?.assumingMemoryBound(to: UInt8.self), salt.count,
          CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(iterations),
          derivedBytes.baseAddress?.assumingMemoryBound(to: UInt8.self), 32)
      }
    }
  }
  guard status == kCCSuccess else { throw VaultError.decryptionFailed }
  return derived
}

private func aesCbc(_ operation: CCOperation, key: Data, iv: Data, input: Data) throws -> Data {
  guard key.count == kCCKeySizeAES256, iv.count == kCCBlockSizeAES128 else {
    throw VaultError.decryptionFailed
  }
  var output = Data(count: input.count + kCCBlockSizeAES128)
  var outputLength = 0
  let capacity = output.count
  let status = output.withUnsafeMutableBytes { outputBytes in
    input.withUnsafeBytes { inputBytes in
      key.withUnsafeBytes { keyBytes in
        iv.withUnsafeBytes { ivBytes in
          CCCrypt(
            operation, CCAlgorithm(kCCAlgorithmAES), CCOptions(kCCOptionPKCS7Padding),
            keyBytes.baseAddress, key.count, ivBytes.baseAddress,
            inputBytes.baseAddress, input.count,
            outputBytes.baseAddress, capacity, &outputLength)
        }
      }
    }
  }
  guard status == kCCSuccess else { throw VaultError.decryptionFailed }
  return output.prefix(outputLength)
}

func randomBytes(_ count: Int) -> Data {
  var data = Data(count: count)
  let status = data.withUnsafeMutableBytes {
    SecRandomCopyBytes(kSecRandomDefault, count, $0.baseAddress!)
  }
  precondition(status == errSecSuccess, "SecRandomCopyBytes failed")
  return data
}
