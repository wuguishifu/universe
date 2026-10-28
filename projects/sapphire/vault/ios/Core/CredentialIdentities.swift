import AuthenticationServices
import Foundation

/// What iOS's QuickType bar suggests. Registered from decrypted summaries, so it's refreshed
/// whenever the app unlocks the vault.
public enum CredentialIdentities {
  public struct Service: Hashable {
    public let identifier: String
    public let type: ASCredentialServiceIdentifier.IdentifierType
  }

  /// How an item's URIs map onto service identifiers: base-domain and host matches register a
  /// domain, starts-with and exact register the URL, and regex/never can't be expressed.
  public static func services(for summary: VaultItemSummary, suffixes: PublicSuffixList = .shared) -> [Service] {
    var seen = Set<Service>()
    return summary.uris.compactMap { loginUri -> Service? in
      let service: Service?
      switch loginUri.match ?? .domain {
      case .domain:
        service = UriMatcher.hostname(of: loginUri.uri)
          .flatMap { suffixes.baseDomain(of: $0) }
          .map { Service(identifier: $0, type: .domain) }
      case .host:
        service = UriMatcher.hostname(of: loginUri.uri).map { Service(identifier: $0, type: .domain) }
      case .startsWith, .exact:
        service = UriMatcher.url(from: loginUri.uri).map { _ in Service(identifier: loginUri.uri, type: .URL) }
      case .regularExpression, .never:
        service = nil
      }
      guard let service, seen.insert(service).inserted else { return nil }
      return service
    }
  }

  public static func replace(with summaries: [VaultItemSummary]) async {
    let store = ASCredentialIdentityStore.shared
    guard await store.state().isEnabled else { return }

    var identities: [any ASCredentialIdentity] = []
    for summary in summaries {
      for service in services(for: summary) {
        let serviceIdentifier = ASCredentialServiceIdentifier(identifier: service.identifier, type: service.type)
        let password = ASPasswordCredentialIdentity(
          serviceIdentifier: serviceIdentifier, user: summary.username ?? summary.name,
          recordIdentifier: summary.id)
        password.rank = summary.favorite ? 1 : 0
        identities.append(password)

        if #available(iOS 18.0, macOS 15.0, *), summary.hasTotp {
          identities.append(
            ASOneTimeCodeCredentialIdentity(
              serviceIdentifier: serviceIdentifier, label: summary.name, recordIdentifier: summary.id))
        }
      }
    }
    try? await store.replaceCredentialIdentities(identities)
  }

  public static func removeAll() async {
    try? await ASCredentialIdentityStore.shared.removeAllCredentialIdentities()
  }
}
