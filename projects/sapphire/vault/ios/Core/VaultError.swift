import Foundation

public enum VaultError: Error, Equatable, LocalizedError {
  case notLoggedIn
  /// The account logged out or logged in again while a sync was running; its results were dropped.
  case accountChanged
  /// The refresh token was rejected; the master password is needed to get a new one.
  case reauthRequired
  /// The Face ID protected user key is gone (Face ID enrollment changed, or it was never stored).
  case keyUnavailable
  case userCanceled
  case authenticationFailed
  case unsupportedKdf(Int)
  case twoFactorUnsupported
  case server(status: Int, message: String)
  case network(String)
  case invalidResponse(String)
  case invalidEncString
  case unsupportedEncryptionType(Int)
  case macMismatch
  case decryptionFailed
  case invalidTotp
  case itemNotFound
  case keychain(OSStatus)
  case misconfigured(String)

  /// Stable code for JS (`error.code`).
  public var code: String {
    switch self {
    case .notLoggedIn: "ERR_VAULT_NOT_LOGGED_IN"
    case .accountChanged: "ERR_VAULT_ACCOUNT_CHANGED"
    case .reauthRequired: "ERR_VAULT_REAUTH_REQUIRED"
    case .keyUnavailable: "ERR_VAULT_KEY_UNAVAILABLE"
    case .userCanceled: "ERR_VAULT_USER_CANCELED"
    case .authenticationFailed: "ERR_VAULT_AUTHENTICATION_FAILED"
    case .unsupportedKdf: "ERR_VAULT_UNSUPPORTED_KDF"
    case .twoFactorUnsupported: "ERR_VAULT_TWO_FACTOR_UNSUPPORTED"
    case .server: "ERR_VAULT_SERVER"
    case .network: "ERR_VAULT_NETWORK"
    case .invalidResponse: "ERR_VAULT_INVALID_RESPONSE"
    case .invalidEncString, .unsupportedEncryptionType, .macMismatch, .decryptionFailed:
      "ERR_VAULT_DECRYPTION_FAILED"
    case .invalidTotp: "ERR_VAULT_INVALID_TOTP"
    case .itemNotFound: "ERR_VAULT_ITEM_NOT_FOUND"
    case .keychain: "ERR_VAULT_KEYCHAIN"
    case .misconfigured: "ERR_VAULT_MISCONFIGURED"
    }
  }

  public var errorDescription: String? {
    switch self {
    case .notLoggedIn: "Not logged in to the vault."
    case .accountChanged: "The vault account changed during the sync."
    case .reauthRequired: "The session expired. Enter your master password to log in again."
    case .keyUnavailable: "Face ID changed or the vault key is missing. Enter your master password."
    case .userCanceled: "Canceled."
    case .authenticationFailed: "Face ID failed."
    case .unsupportedKdf(let kdf): "Unsupported KDF (type \(kdf)). Only PBKDF2-SHA256 is supported."
    case .twoFactorUnsupported: "Two-step login is turned on for this account, which isn't supported yet."
    case .server(let status, let message): "Server error \(status): \(message)"
    case .network(let message): "Couldn't reach the vault: \(message)"
    case .invalidResponse(let message): "Unexpected response from the vault: \(message)"
    case .invalidEncString: "Malformed encrypted value."
    case .unsupportedEncryptionType(let type): "Unsupported encryption type \(type)."
    case .macMismatch: "Encrypted value failed its integrity check."
    case .decryptionFailed: "Couldn't decrypt the vault. Log in again with your master password."
    case .invalidTotp: "Invalid TOTP secret."
    case .itemNotFound: "Item not found."
    case .keychain(let status): "Keychain error \(status)."
    case .misconfigured(let message): "Vault misconfigured: \(message)"
    }
  }
}
