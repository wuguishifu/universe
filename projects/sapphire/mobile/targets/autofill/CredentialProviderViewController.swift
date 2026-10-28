import AuthenticationServices
import SapphireVaultCore
import SwiftUI

/// The AutoFill extension. It never touches the network: it reads the cache the app syncs and
/// the Face ID protected user key from the shared Keychain group. Each launch is one fill, so the
/// key it unlocks lives only until the request completes or is canceled.
class CredentialProviderViewController: ASCredentialProviderViewController {
  private let model = AutoFillModel()
  private var pending: (() -> Void)?

  override func viewDidLoad() {
    super.viewDidLoad()
    model.complete = { [weak self] completion in self?.complete(completion) }

    let host = UIHostingController(rootView: AutoFillView(model: model))
    addChild(host)
    host.view.frame = view.bounds
    host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(host.view)
    host.didMove(toParent: self)
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    // Face ID waits until the sheet is on screen.
    pending?()
    pending = nil
  }

  /// Passwords → Sapphire, or the key icon in the QuickType bar.
  override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
    pending = { [model] in model.showList(mode: .password, for: serviceIdentifiers) }
  }

  @available(iOS 18.0, *)
  override func prepareOneTimeCodeCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
    pending = { [model] in model.showList(mode: .oneTimeCode, for: serviceIdentifiers) }
  }

  /// A QuickType suggestion was tapped. Filling always needs Face ID, so ask iOS for the UI.
  override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {
    extensionContext.cancelRequest(
      withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.userInteractionRequired.rawValue))
  }

  override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
    guard let recordIdentifier = credentialRequest.credentialIdentity.recordIdentifier else {
      complete(.cancel)
      return
    }
    let mode: AutoFillModel.Mode =
      if #available(iOS 18.0, *), credentialRequest.type == .oneTimeCode { .oneTimeCode } else { .password }
    pending = { [model] in model.fill(id: recordIdentifier, mode: mode) }
  }

  private func complete(_ completion: AutoFillModel.Completion) {
    switch completion {
    case .password(let user, let password):
      extensionContext.completeRequest(withSelectedCredential: ASPasswordCredential(user: user, password: password))
    case .oneTimeCode(let code):
      if #available(iOS 18.0, *) {
        extensionContext.completeOneTimeCodeRequest(using: ASOneTimeCodeCredential(code: code))
      }
    case .cancel:
      extensionContext.cancelRequest(
        withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.userCanceled.rawValue))
    }
  }
}

@MainActor
final class AutoFillModel: ObservableObject {
  enum Mode {
    case password
    case oneTimeCode
  }

  enum Completion {
    case password(user: String, password: String)
    case oneTimeCode(String)
    case cancel
  }

  enum Screen {
    case loading
    case message(String, retry: (() -> Void)?)
    case list(suggested: [VaultItemSummary], all: [VaultItemSummary], domain: String?)
  }

  @Published var screen: Screen = .loading
  @Published var search = ""
  var complete: ((Completion) -> Void)?

  private(set) var mode: Mode = .password
  private var snapshot: VaultSnapshot?
  private var userKey: VaultKey?

  private lazy var vault = Result { try Vault(environment: .fromInfoPlist()) }

  func showList(mode: Mode, for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
    self.mode = mode
    unlock { [self] snapshot, key in
      var summaries = try snapshot.summaries(userKey: key)
      if mode == .oneTimeCode {
        summaries = summaries.filter(\.hasTotp)
      }
      summaries.sort {
        $0.favorite != $1.favorite
          ? $0.favorite : $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
      }

      let targets = serviceIdentifiers.map { $0.type == .domain ? "https://\($0.identifier)" : $0.identifier }
      let suggested = summaries.filter { summary in
        summary.uris.contains { uri in targets.contains { UriMatcher.matches(uri, target: $0) } }
      }
      let domain = targets.first.flatMap(UriMatcher.hostname(of:))
      screen = .list(suggested: suggested, all: summaries, domain: domain)
    }
  }

  func fill(id: String, mode: Mode) {
    self.mode = mode
    unlock { [self] _, _ in select(id: id) }
  }

  func select(id: String) {
    guard let snapshot, let userKey else { return }
    do {
      let secret = try snapshot.secret(id: id, userKey: userKey)
      switch mode {
      case .password:
        let summary = try snapshot.summary(id: id, userKey: userKey)
        complete?(.password(user: summary.username ?? "", password: secret.password ?? ""))
      case .oneTimeCode:
        guard let totp = secret.totp else { throw VaultError.invalidTotp }
        complete?(.oneTimeCode(try Totp(totp).code()))
      }
    } catch {
      screen = .message(error.localizedDescription, retry: nil)
    }
  }

  func cancel() {
    complete?(.cancel)
  }

  /// Face ID once, then keeps the key for the rest of this (single-fill) extension launch.
  private func unlock(then body: @escaping (VaultSnapshot, VaultKey) throws -> Void) {
    screen = .loading
    let vault: Vault
    do {
      vault = try self.vault.get()
    } catch {
      screen = .message(error.localizedDescription, retry: nil)
      return
    }

    Task {
      do {
        let (snapshot, key) = try await Task.detached {
          let snapshot = try vault.snapshot()
          return (snapshot, try vault.userKey(prompt: "Unlock your vault to fill"))
        }.value
        self.snapshot = snapshot
        self.userKey = key
        try body(snapshot, key)
      } catch VaultError.notLoggedIn {
        screen = .message("Open Sapphire to sign in to your vault.", retry: nil)
      } catch VaultError.keyUnavailable {
        screen = .message("Face ID changed. Open Sapphire and enter your master password.", retry: nil)
      } catch VaultError.userCanceled, VaultError.authenticationFailed {
        screen = .message("Vault locked.", retry: { [weak self] in self?.unlock(then: body) })
      } catch {
        screen = .message(error.localizedDescription, retry: nil)
      }
    }
  }
}
