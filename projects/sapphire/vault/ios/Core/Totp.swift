import CryptoKit
import Foundation

/// A login's TOTP field, in any of the forms Bitwarden accepts: a bare base32 secret,
/// an `otpauth://totp/...` URI, or `steam://<secret>`.
public struct Totp: Equatable {
  public enum Algorithm: String {
    case sha1 = "SHA1"
    case sha256 = "SHA256"
    case sha512 = "SHA512"
  }

  public let secret: Data
  public let algorithm: Algorithm
  public let digits: Int
  public let period: Int
  public let steam: Bool

  public init(secret: Data, algorithm: Algorithm = .sha1, digits: Int = 6, period: Int = 30, steam: Bool = false) {
    self.secret = secret
    self.algorithm = algorithm
    self.digits = digits
    self.period = period
    self.steam = steam
  }

  public init(_ value: String) throws {
    let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
    let lowercased = value.lowercased()

    if lowercased.hasPrefix("steam://") {
      self.init(secret: try base32Decode(String(value.dropFirst("steam://".count))), digits: 5, steam: true)
      return
    }

    guard lowercased.hasPrefix("otpauth://") else {
      self.init(secret: try base32Decode(value))
      return
    }

    guard let components = URLComponents(string: value), components.host?.lowercased() == "totp" else {
      throw VaultError.invalidTotp
    }
    var params: [String: String] = [:]
    for item in components.queryItems ?? [] {
      params[item.name.lowercased()] = item.value
    }
    guard let secret = params["secret"] else { throw VaultError.invalidTotp }

    // Out-of-range values fall back to the defaults, the same as Bitwarden's clients.
    let digits = params["digits"].flatMap(Int.init).flatMap { (1...10).contains($0) ? $0 : nil } ?? 6
    let period = params["period"].flatMap(Int.init).flatMap { $0 > 0 ? $0 : nil } ?? 30
    let algorithm = params["algorithm"].flatMap { Algorithm(rawValue: $0.uppercased()) } ?? .sha1
    let steam = params["encoder"]?.lowercased() == "steam"

    self.init(
      secret: try base32Decode(secret), algorithm: algorithm, digits: steam ? 5 : digits,
      period: period, steam: steam)
  }

  public func code(at date: Date = Date()) -> String {
    let counter = UInt64(max(0, date.timeIntervalSince1970) / Double(period))
    let message = withUnsafeBytes(of: counter.bigEndian) { Data($0) }
    let key = SymmetricKey(data: secret)
    let hash: Data =
      switch algorithm {
      case .sha1: Data(HMAC<Insecure.SHA1>.authenticationCode(for: message, using: key))
      case .sha256: Data(HMAC<SHA256>.authenticationCode(for: message, using: key))
      case .sha512: Data(HMAC<SHA512>.authenticationCode(for: message, using: key))
      }

    // RFC 4226 dynamic truncation.
    let offset = Int(hash[hash.count - 1] & 0x0f)
    var truncated =
      (UInt32(hash[offset] & 0x7f) << 24) | (UInt32(hash[offset + 1]) << 16)
      | (UInt32(hash[offset + 2]) << 8) | UInt32(hash[offset + 3])

    if steam {
      let alphabet = Array("23456789BCDFGHJKMNPQRTVWXY")
      var code = ""
      for _ in 0..<digits {
        code.append(alphabet[Int(truncated % UInt32(alphabet.count))])
        truncated /= UInt32(alphabet.count)
      }
      return code
    }

    let modulus = (0..<digits).reduce(UInt64(1)) { result, _ in result * 10 }
    let code = String(UInt64(truncated) % modulus)
    return String(repeating: "0", count: max(0, digits - code.count)) + code
  }

  /// Seconds until `code(at:)` changes.
  public func remaining(at date: Date = Date()) -> Int {
    let elapsed = Int(max(0, date.timeIntervalSince1970)) % period
    return period - elapsed
  }
}

func base32Decode(_ string: String) throws -> Data {
  let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
  var lookup: [Character: UInt8] = [:]
  for (index, character) in alphabet.enumerated() {
    lookup[character] = UInt8(index)
  }

  var buffer: UInt32 = 0
  var bits = 0
  var output = Data()
  for character in string.uppercased() where character != "=" && character != " " && character != "-" {
    guard let value = lookup[character] else { throw VaultError.invalidTotp }
    buffer = (buffer << 5) | UInt32(value)
    bits += 5
    if bits >= 8 {
      bits -= 8
      output.append(UInt8((buffer >> UInt32(bits)) & 0xff))
    }
  }
  guard !output.isEmpty else { throw VaultError.invalidTotp }
  return output
}
