import XCTest

@testable import SapphireVaultCore

/// Records requests instead of sending them.
final class RecordingURLProtocol: URLProtocol {
  nonisolated(unsafe) static var requests: [URLRequest] = []
  nonisolated(unsafe) static var body = Data(#"{"ciphers":[]}"#.utf8)

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    Self.requests.append(request)
    let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Self.body)
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}
}

final class VaultApiTests: XCTestCase {
  func testSendsClientVersionSoTheSyncIncludesSshKeys() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [RecordingURLProtocol.self]
    RecordingURLProtocol.requests = []
    let api = VaultApi(baseURL: URL(string: "https://vault.example.com")!, session: URLSession(configuration: configuration))

    _ = try await api.sync(accessToken: "token")

    let request = try XCTUnwrap(RecordingURLProtocol.requests.first)
    XCTAssertEqual(request.url?.path(), "/api/sync")
    // Vaultwarden filters out SSH keys below 2024.12.0, or with no version at all.
    XCTAssertEqual(request.value(forHTTPHeaderField: "Bitwarden-Client-Version"), "2024.12.0")
    XCTAssertEqual(request.value(forHTTPHeaderField: "Device-Type"), "1")
  }
}
