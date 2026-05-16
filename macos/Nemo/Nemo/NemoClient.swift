import Foundation

struct NemoClient {
    var transport: HTTPJSONTransport

    func health() async throws -> AgentHealth {
        try await transport.get("/v1/health")
    }

    func meta() async throws -> ServerMeta {
        try await transport.get("/v1/meta")
    }

    func apps() async throws -> [AppSummary] {
        let response: AppsResponse = try await transport.get("/v1/apps")
        return response.apps.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    func exchangePairing(id: String, code: String, deviceName: String) async throws -> PairingExchangeResponse {
        let request = PairingExchangeRequest(pairingId: id, code: code, deviceName: deviceName)
        return try await transport.post("/v1/pairing/exchange", body: request)
    }

    func startBrowserPairing(endpoint: String, deviceName: String) async throws -> BrowserPairingStartResponse {
        let request = BrowserPairingStartRequest(endpoint: endpoint, deviceName: deviceName)
        return try await transport.post("/v1/pairing/browser/start", body: request)
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
}
