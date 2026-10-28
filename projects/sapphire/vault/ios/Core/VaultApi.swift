import Foundation

public struct DeviceInfo {
  public let identifier: String
  public let name: String
  /// Bitwarden's device type enum; 1 is iOS.
  public let type: Int

  public init(identifier: String, name: String, type: Int = 1) {
    self.identifier = identifier
    self.name = name
    self.type = type
  }
}

public struct TokenResponse {
  public let accessToken: String
  public let expiresIn: TimeInterval
  public let refreshToken: String?
  /// The user key wrapped with the master key (`Key`); only on password logins.
  public let encryptedUserKey: String?
}

/// The handful of Bitwarden endpoints the vault needs, against a Vaultwarden base URL.
public struct VaultApi {
  static let clientId = "mobile"

  let baseURL: URL
  let session: URLSession

  public init(baseURL: URL, session: URLSession) {
    self.baseURL = baseURL
    self.session = session
  }

  /// The account's PBKDF2 iteration count.
  public func prelogin(email: String) async throws -> Int {
    let json = try await send(
      jsonRequest(path: "identity/accounts/prelogin", body: ["email": email]))
    let kdf = json.field("kdf") as? Int ?? 0
    guard kdf == 0 else { throw VaultError.unsupportedKdf(kdf) }
    guard let iterations = json.field("kdfIterations") as? Int, iterations > 0 else {
      throw VaultError.invalidResponse("prelogin has no kdfIterations")
    }
    return iterations
  }

  public func login(email: String, masterPasswordHash: String, device: DeviceInfo) async throws -> TokenResponse {
    try await token([
      "grant_type": "password",
      "username": email,
      "password": masterPasswordHash,
      "scope": "api offline_access",
      "client_id": Self.clientId,
      "deviceType": String(device.type),
      "deviceIdentifier": device.identifier,
      "deviceName": device.name,
    ])
  }

  public func refresh(refreshToken: String) async throws -> TokenResponse {
    do {
      return try await token([
        "grant_type": "refresh_token",
        "client_id": Self.clientId,
        "refresh_token": refreshToken,
      ])
    } catch VaultError.server(let status, _) where status == 400 || status == 401 {
      throw VaultError.reauthRequired
    }
  }

  /// The raw `/api/sync` response.
  public func sync(accessToken: String) async throws -> Data {
    var request = URLRequest(url: baseURL.appending(path: "api/sync"))
    request.url?.append(queryItems: [URLQueryItem(name: "excludeDomains", value: "true")])
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    let (data, _) = try await perform(request)
    return data
  }

  private func token(_ form: [String: String]) async throws -> TokenResponse {
    var request = URLRequest(url: baseURL.appending(path: "identity/connect/token"))
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded; charset=utf-8", forHTTPHeaderField: "Content-Type")
    request.httpBody = Data(formEncode(form).utf8)

    let json = try await send(request)
    guard let accessToken = json.field("access_token") as? String else {
      throw VaultError.invalidResponse("token response has no access_token")
    }
    return TokenResponse(
      accessToken: accessToken,
      expiresIn: json.field("expires_in") as? TimeInterval ?? 3600,
      refreshToken: json.field("refresh_token") as? String,
      encryptedUserKey: json.field("Key") as? String)
  }

  private func jsonRequest(path: String, body: [String: Any]) throws -> URLRequest {
    var request = URLRequest(url: baseURL.appending(path: path))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    return request
  }

  private func send(_ request: URLRequest) async throws -> [String: Any] {
    let (data, _) = try await perform(request)
    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw VaultError.invalidResponse("expected a JSON object")
    }
    return json
  }

  private func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    var request = request
    request.setValue(String(1), forHTTPHeaderField: "Device-Type")
    request.timeoutInterval = 30

    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch {
      throw VaultError.network(error.localizedDescription)
    }
    guard let http = response as? HTTPURLResponse else {
      throw VaultError.invalidResponse("not an HTTP response")
    }
    guard (200..<300).contains(http.statusCode) else {
      let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
      if json.field("TwoFactorProviders") != nil {
        throw VaultError.twoFactorUnsupported
      }
      throw VaultError.server(status: http.statusCode, message: errorMessage(json) ?? "HTTP \(http.statusCode)")
    }
    return (data, http)
  }
}

private func errorMessage(_ json: [String: Any]) -> String? {
  if let model = json.field("ErrorModel") as? [String: Any], let message = model.field("Message") as? String {
    return message
  }
  return json.field("message") as? String ?? json.field("error_description") as? String
    ?? json.field("error") as? String
}

private func formEncode(_ form: [String: String]) -> String {
  // `CharacterSet.alphanumerics` includes non-ASCII letters, which have to be escaped.
  let allowed = CharacterSet(
    charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._*")
  return form
    .sorted { $0.key < $1.key }
    .map { key, value in
      let encoded = value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
      return "\(key)=\(encoded)"
    }
    .joined(separator: "&")
}
