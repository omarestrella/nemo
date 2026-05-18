import Foundation

struct NemoClient {
  let endpoint: URL
  let credential: String?
  var session: URLSession = .shared

  func health() async throws -> AgentHealth {
    try await get("/v1/health")
  }

  func meta() async throws -> ServerMeta {
    try await get("/v1/meta")
  }

  func apps() async throws -> [AppSummary] {
    let response: AppsResponse = try await get("/v1/apps")
    return response.apps.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
  }

  func app(_ name: String) async throws -> AppSummary {
    try await get("/v1/apps/\(Self.pathComponent(name))")
  }

  func logs(app name: String, lines: Int = 100) async throws -> AppLogsResponse {
    try await get("/v1/apps/\(Self.pathComponent(name))/logs?lines=\(lines)")
  }

  func events(limit: Int = 50) async throws -> PlatformEventsResponse {
    try await get("/v1/events?limit=\(limit)")
  }

  func exchangePairing(id: String, code: String, deviceName: String) async throws -> PairingExchangeResponse {
    let request = PairingExchangeRequest(pairingId: id, code: code, deviceName: deviceName)
    return try await post("/v1/pairing/exchange", body: request)
  }

  func startBrowserPairing(endpoint: String, deviceName: String, codeChallenge: String) async throws -> BrowserPairingStartResponse {
    let request = BrowserPairingStartRequest(
      endpoint: endpoint,
      deviceName: deviceName,
      codeChallenge: codeChallenge,
      codeChallengeMethod: "S256"
    )
    return try await post("/v1/pairing/browser/start", body: request)
  }

  func exchangeBrowserPairing(deviceCode: String, codeVerifier: String, deviceName: String) async throws -> PairingExchangeResponse {
    let request = BrowserPairingExchangeRequest(deviceCode: deviceCode, codeVerifier: codeVerifier, deviceName: deviceName)
    return try await post("/v1/pairing/browser/exchange", body: request)
  }

  private func get<T: Decodable>(_ path: String) async throws -> T {
    var request = try request(path: path)
    request.httpMethod = "GET"
    return try await send(request)
  }

  private func post<Body: Encodable, Response: Decodable>(_ path: String, body: Body) async throws -> Response {
    var request = try request(path: path)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(body)
    return try await send(request)
  }

  private func request(path: String) throws -> URLRequest {
    try validateEndpoint()
    guard let url = URL(string: path, relativeTo: endpoint)?.absoluteURL else {
      throw TransportError.invalidEndpoint
    }
    var request = URLRequest(url: url)
    request.timeoutInterval = 8
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let credential {
      request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
    }
    return request
  }

  private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
    do {
      let (data, response) = try await session.data(for: request)
      guard let httpResponse = response as? HTTPURLResponse else {
        throw TransportError.unreachable
      }
      if (200..<300).contains(httpResponse.statusCode) {
        return try JSONDecoder().decode(T.self, from: data)
      }
      if let body = try? JSONDecoder().decode(NemoAPIErrorBody.self, from: data) {
        throw TransportError.api(status: httpResponse.statusCode, code: body.error.code, message: body.error.message)
      }
      throw TransportError.httpStatus(httpResponse.statusCode)
    } catch let error as TransportError {
      throw error
    } catch let error as URLError {
      throw TransportError.url(error)
    } catch {
      throw TransportError.decoding(error)
    }
  }

  private func validateEndpoint() throws {
    guard let scheme = endpoint.scheme?.lowercased(),
          endpoint.host(percentEncoded: false) != nil,
          scheme == "http" || scheme == "https" else {
      throw TransportError.invalidEndpoint
    }
  }

  private static func pathComponent(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
  }
}

enum TransportError: LocalizedError {
  case invalidEndpoint
  case unreachable
  case url(URLError)
  case httpStatus(Int)
  case api(status: Int, code: String, message: String)
  case decoding(Error)

  var errorDescription: String? {
    switch self {
    case .invalidEndpoint:
      return "Enter a valid HTTP or HTTPS endpoint."
    case .unreachable:
      return "Endpoint unreachable."
    case .url(let error):
      if error.code == .serverCertificateUntrusted || error.code == .secureConnectionFailed || error.code == .serverCertificateHasBadDate || error.code == .serverCertificateHasUnknownRoot {
        return "TLS or certificate validation failed."
      }
      return error.localizedDescription
    case .httpStatus(let status):
      return "Agent returned HTTP \(status)."
    case .api(let status, let code, let message):
      if status == 401 {
        return "Missing or invalid credential."
      }
      if code == "UNSUPPORTED_PLATFORM" {
        return "Agent reachable, but the platform command failed."
      }
      return "\(message) (\(code))"
    case .decoding:
      return "Unsupported agent response."
    }
  }
}

private struct PairingExchangeRequest: Encodable {
  let pairingId: String
  let code: String
  let deviceName: String
}

private struct BrowserPairingStartRequest: Encodable {
  let endpoint: String
  let deviceName: String
  let codeChallenge: String
  let codeChallengeMethod: String
}

private struct BrowserPairingExchangeRequest: Encodable {
  let deviceCode: String
  let codeVerifier: String
  let deviceName: String
}

struct AgentHealth: Decodable {
  let status: String
  let apiVersion: String
  let agentVersion: String
}

struct ServerMeta: Decodable {
  let apiVersion: String
  let agentVersion: String
  let instanceId: String
  let host: String
  let platform: String
  let platformVersion: String?
  let capabilities: [String]
}

struct AppSummary: Decodable, Identifiable {
  var id: String { name }

  let name: String
  let urls: [String]
  let running: Bool?
  let deployed: Bool?
  let processCount: Int?
  let httpsActive: Bool?
  let containerStatus: String?
  let ports: String?
  let domains: [String]

  var primaryURL: String? { urls.first }
}

struct AppsResponse: Decodable {
  let apps: [AppSummary]
}

struct LogLine: Decodable, Identifiable {
  var id: Int { index }

  let index: Int
  let raw: String
  let message: String
  let timestamp: String?
  let timestampText: String?
  let source: String?
}

struct AppLogsResponse: Decodable {
  let status: String
  let app: String
  let lines: Int
  let logs: [LogLine]
  let truncated: Bool
}

struct PlatformEvent: Decodable, Identifiable {
  var id: Int { index }

  let index: Int
  let raw: String
  let message: String
  let timestamp: String?
  let timestampText: String?
  let host: String?
  let source: String?
  let pid: Int?
  let action: String?
  let app: String?
  let args: [String]
}

struct PlatformEventsResponse: Decodable {
  let status: String
  let limit: Int
  let events: [PlatformEvent]
  let truncated: Bool?
  let retryable: Bool?
  let message: String?
  let raw: String?
}

struct PairingExchangeResponse: Decodable {
  let credential: String
  let server: PairingServer
}

struct BrowserPairingStartResponse: Decodable {
  let pairUrl: String
  let challenge: String
  let deviceCode: String
  let expiresAt: String
  let intervalSeconds: Double
}

struct PairingServer: Decodable {
  let apiVersion: String
  let agentVersion: String
  let instanceId: String
  let host: String
  let platform: String
}

struct NemoAPIErrorBody: Decodable {
  let error: NemoAPIError
}

struct NemoAPIError: Decodable {
  let code: String
  let message: String
  let retryable: Bool?
}
