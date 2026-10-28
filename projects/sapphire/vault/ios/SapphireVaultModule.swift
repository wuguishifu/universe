import ExpoModulesCore
import SapphireProxy
import SapphireVaultCore
import UIKit
import UniformTypeIdentifiers

/// The vault's JS API. Secrets only cross into JS through `reveal`; copying a password goes
/// straight from the Keychain to the pasteboard.
public class SapphireVaultModule: Module {
  static let clipboardLifetime: TimeInterval = 60

  private let vault = Result { try Vault(environment: .fromInfoPlist()) }

  public func definition() -> ModuleDefinition {
    Name("SapphireVault")

    OnCreate {
      VaultLog.sink = TailnetProxy.log
    }

    AsyncFunction("getState") { () throws -> [String: Any] in
      try bridged {
        let state = try self.vault.get().state()
        var result: [String: Any] = [
          "loggedIn": state.loggedIn,
          "serverUrl": state.serverURL,
          "needsReauth": state.needsReauth,
          "keyAvailable": state.keyAvailable,
        ]
        result["email"] = state.email
        result["lastSync"] = state.lastSync.map { $0.timeIntervalSince1970 * 1000 }
        return result
      }
    }

    AsyncFunction("login") { (serverUrl: String, email: String, password: String) async throws in
      try await bridged {
        try await self.vault.get().login(
          serverURL: serverUrl, email: email, password: password, session: try tailnetSession())
      }
    }

    AsyncFunction("sync") { () async throws -> [String: Any] in
      try await bridged {
        let result = try await self.vault.get().sync(session: try tailnetSession())
        return ["syncedAt": result.date.timeIntervalSince1970 * 1000, "changed": result.changed]
      }
    }

    // Each of these prompts for Face ID: the user key is read from the Keychain for the one
    // operation and dropped.

    AsyncFunction("unlock") { () async throws -> [[String: Any]] in
      try await bridged {
        let vault = try self.vault.get()
        let summaries = try await Task.detached {
          let userKey = try vault.userKey(prompt: "Unlock your vault")
          // Prompt first, then give a sync that's already running (e.g. the app just opened) a
          // moment to land, so the list is read from the cache it's about to write.
          await vault.waitForSync(timeout: .seconds(5))
          return try vault.snapshot().summaries(userKey: userKey)
        }.value
        await CredentialIdentities.replace(with: summaries)
        return summaries.map(serialize)
      }
    }

    AsyncFunction("reveal") { (id: String) async throws -> [String: Any] in
      try await bridged {
        let secret = try await self.secret(id: id, prompt: "Show this password")
        var result: [String: Any] = [:]
        result["password"] = secret.password
        result["totp"] = secret.totp
        return result
      }
    }

    AsyncFunction("copyPassword") { (id: String) async throws in
      try await bridged {
        guard let password = try await self.secret(id: id, prompt: "Copy this password").password else {
          throw VaultError.itemNotFound
        }
        await copyToPasteboard(password)
      }
    }

    AsyncFunction("copyTotp") { (id: String) async throws in
      try await bridged {
        guard let totp = try await self.secret(id: id, prompt: "Copy this code").totp else {
          throw VaultError.itemNotFound
        }
        await copyToPasteboard(try Totp(totp).code())
      }
    }

    Function("totp") { (value: String) throws -> [String: Any] in
      try bridged {
        let totp = try Totp(value)
        let now = Date()
        return ["code": totp.code(at: now), "period": totp.period, "remaining": totp.remaining(at: now)]
      }
    }

    AsyncFunction("copy") { (text: String) async in
      await copyToPasteboard(text)
    }

    AsyncFunction("logout") { () async throws in
      try await bridged {
        try await self.vault.get().logout()
        await CredentialIdentities.removeAll()
      }
    }
  }

  private func secret(id: String, prompt: String) async throws -> VaultItemSecret {
    let vault = try vault.get()
    return try await Task.detached {
      try vault.snapshot().secret(id: id, userKey: vault.userKey(prompt: prompt))
    }.value
  }
}

private func tailnetSession() throws -> URLSession {
  guard let session = TailnetProxy.session() else {
    throw VaultError.network("the tailnet proxy isn't running")
  }
  return session
}

/// Local only (no Universal Clipboard to the Mac) and cleared by the system after a minute.
@MainActor
private func copyToPasteboard(_ text: String) {
  UIPasteboard.general.setItems(
    [[UTType.plainText.identifier: text]],
    options: [
      .localOnly: true,
      .expirationDate: Date().addingTimeInterval(SapphireVaultModule.clipboardLifetime),
    ])
}

private func serialize(_ summary: VaultItemSummary) -> [String: Any] {
  var result: [String: Any] = [
    "id": summary.id,
    "name": summary.name,
    "uris": summary.uris.map { uri -> [String: Any] in
      var result: [String: Any] = ["uri": uri.uri]
      result["match"] = uri.match?.rawValue
      return result
    },
    "favorite": summary.favorite,
    "hasTotp": summary.hasTotp,
  ]
  result["username"] = summary.username
  return result
}

/// Turns `VaultError`s into exceptions whose `code` JS can switch on.
private func bridged<T>(_ body: () throws -> T) throws -> T {
  do {
    return try body()
  } catch let error as VaultError {
    throw VaultException(error)
  }
}

private func bridged<T>(_ body: () async throws -> T) async throws -> T {
  do {
    return try await body()
  } catch let error as VaultError {
    throw VaultException(error)
  }
}

final class VaultException: Exception, @unchecked Sendable {
  init(_ error: VaultError) {
    super.init(name: "VaultError", description: error.localizedDescription, code: error.code)
  }

  override var reason: String {
    description
  }
}
