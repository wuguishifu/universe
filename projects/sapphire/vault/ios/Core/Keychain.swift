import Foundation
import LocalAuthentication
import Security

/// Generic-password items under one service, in one access group.
public struct Keychain {
  public enum Protection {
    /// Readable without user interaction once the device has been unlocked after boot.
    case afterFirstUnlock
    /// Every read needs Face ID. Enrolling or removing a face destroys the item for good.
    case biometryCurrentSet
  }

  public enum Presence {
    case present
    case missing
  }

  static let service = "dev.wuguishifu.sapphire.vault"

  let accessGroup: String

  public init(accessGroup: String) {
    self.accessGroup = accessGroup
  }

  public func set(_ data: Data, account: String, protection: Protection) throws {
    delete(account: account)

    var query = baseQuery(account: account)
    query[kSecValueData] = data
    switch protection {
    case .afterFirstUnlock:
      query[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    case .biometryCurrentSet:
      var error: Unmanaged<CFError>?
      guard
        let access = SecAccessControlCreateWithFlags(
          nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, &error)
      else {
        throw VaultError.keychain(errSecParam)
      }
      query[kSecAttrAccessControl] = access
    }

    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else { throw VaultError.keychain(status) }
  }

  /// Reads an item. For a `.biometryCurrentSet` item this blocks on the Face ID prompt, so call
  /// it off the main thread.
  public func get(account: String, prompt: String? = nil) throws -> Data? {
    var query = baseQuery(account: account)
    query[kSecReturnData] = true
    query[kSecMatchLimit] = kSecMatchLimitOne
    if let prompt {
      let context = LAContext()
      context.localizedReason = prompt
      query[kSecUseAuthenticationContext] = context
    }

    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    switch status {
    case errSecSuccess:
      return result as? Data
    case errSecItemNotFound:
      return nil
    case errSecUserCanceled:
      throw VaultError.userCanceled
    case errSecAuthFailed:
      throw VaultError.authenticationFailed
    default:
      throw VaultError.keychain(status)
    }
  }

  /// Whether an item exists, without prompting for Face ID.
  public func presence(account: String) -> Presence {
    let context = LAContext()
    context.interactionNotAllowed = true

    var query = baseQuery(account: account)
    query[kSecUseAuthenticationContext] = context
    let status = SecItemCopyMatching(query as CFDictionary, nil)
    // A Face ID protected item answers "interaction not allowed" instead of returning it.
    return status == errSecSuccess || status == errSecInteractionNotAllowed ? .present : .missing
  }

  /// The team ID prefix (`ABCDE12345.`) of this target's keychain groups, read off the default
  /// access group a probe item lands in.
  static func teamPrefix() throws -> String {
    let query: [CFString: Any] = [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: "\(service).probe",
      kSecAttrAccount: "teamPrefix",
      kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
      kSecReturnAttributes: true,
      kSecUseDataProtectionKeychain: true,
    ]
    var result: CFTypeRef?
    var status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound {
      status = SecItemAdd(query as CFDictionary, &result)
    }
    guard status == errSecSuccess, let attributes = result as? [CFString: Any],
      let group = attributes[kSecAttrAccessGroup] as? String, let dot = group.firstIndex(of: ".")
    else {
      throw VaultError.keychain(status)
    }
    return String(group[...dot])
  }

  @discardableResult
  public func delete(account: String) -> Bool {
    SecItemDelete(baseQuery(account: account) as CFDictionary) == errSecSuccess
  }

  private func baseQuery(account: String) -> [CFString: Any] {
    [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: Self.service,
      kSecAttrAccount: account,
      kSecAttrAccessGroup: accessGroup,
      kSecUseDataProtectionKeychain: true,
    ]
  }
}
