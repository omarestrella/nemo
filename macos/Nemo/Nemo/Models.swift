import Foundation

enum AuthMethod: String, CaseIterable, Identifiable, Codable {
    case pairing = "Pairing Code"

    var id: String { rawValue }
}

struct NemoProfile: Codable, Equatable {
    var displayName: String
    var endpointURL: String
    var authMethod: AuthMethod
    var refreshIntervalSeconds: Double

    static let `default` = NemoProfile(
        displayName: "Nemo",
        endpointURL: "http://127.0.0.1:7331",
        authMethod: .pairing,
        refreshIntervalSeconds: 30
    )
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

struct DiscoveredAgent: Identifiable, Equatable {
    var id: String { endpoint.absoluteString }

    let name: String
    let host: String
    let port: Int
    let path: String
    let endpoint: URL
}

struct PairingExchangeResponse: Decodable {
    let credential: String
    let server: PairingServer
}

struct BrowserPairingStartResponse: Decodable {
    let pairUrl: String
    let challenge: String
    let expiresAt: String
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

enum ConnectionStatus: Equatable {
    case idle
    case loading
    case ready
    case blocked(String)
    case failed(String)

    var message: String {
        switch self {
        case .idle:
            "Not refreshed yet"
        case .loading:
            "Refreshing"
        case .ready:
            "Connected"
        case .blocked(let message), .failed(let message):
            message
        }
    }
}
