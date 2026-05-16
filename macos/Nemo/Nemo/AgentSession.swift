import Foundation
import AppKit
import CryptoKit
import Security
import SwiftUI

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

@Observable
final class AgentSession {
    var profile: NemoProfile {
        didSet { saveProfile() }
    }
    var status: ConnectionStatus = .idle
    var serverMeta: ServerMeta?
    var apps: [AppSummary] = []
    var lastRefresh: Date?
    var pairingId = ""
    var pairingCode = ""
    var manualPairingEndpoint = ""
    var discoveredAgents: [DiscoveredAgent] = []

    private let keychain = KeychainStore()
    private let discoveryService = AgentDiscoveryService()
    private var credential: String?
    private var refreshTask: Task<Void, Never>?
    private var browserPairingTask: Task<Void, Never>?

    init() {
        self.profile = Self.loadProfile()
        self.manualPairingEndpoint = profile.endpointURL
        self.credential = try? keychain.credential(account: Self.credentialAccount)
        self.discoveryService.onAgentsChanged = { [weak self] agents in
            self?.discoveredAgents = agents
        }
    }

    var menuBarSymbol: String {
        switch status {
        case .ready:
            apps.contains(where: { $0.running == false }) ? "server.rack" : "server.rack"
        case .loading:
            "arrow.triangle.2.circlepath"
        case .blocked, .failed:
            "exclamationmark.triangle"
        case .idle:
            "server.rack"
        }
    }

    var hasCredential: Bool {
        credential != nil
    }

    func start() async {
        discoveryService.start()
        if refreshTask == nil {
            refreshTask = Task { [weak self] in
                await self?.runRefreshLoop()
            }
        }
        await refresh()
    }

    func refresh() async {
        guard let endpoint = normalizedEndpoint(from: profile.endpointURL) else {
            status = .failed("Enter a valid endpoint URL.")
            return
        }

        status = .loading
        let client = NemoClient(endpoint: endpoint, credential: credential)
        do {
            let health = try await client.health()
            guard health.apiVersion == "1" else {
                status = .failed("Unsupported agent API version \(health.apiVersion).")
                return
            }
            guard credential != nil else {
                status = .failed("Missing or invalid credential.")
                return
            }
            async let meta = client.meta()
            async let appSummaries = client.apps()
            serverMeta = try await meta
            apps = try await appSummaries
            lastRefresh = Date()
            status = .ready
        } catch let error as TransportError {
            status = transportStatus(from: error)
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    func pairManually() async {
        let endpointText = manualPairingEndpoint.trimmingCharacters(in: .whitespacesAndNewlines)
        if !endpointText.isEmpty {
            profile.endpointURL = endpointText
        }
        await pair(endpointText: profile.endpointURL, id: pairingId, code: pairingCode)
    }

    func startBrowserPairing() async {
        guard let endpoint = normalizedEndpoint(from: profile.endpointURL) else {
            status = .failed("Enter a valid endpoint URL.")
            return
        }

        status = .loading
        let client = NemoClient(endpoint: endpoint, credential: nil)
        do {
            let verifier = try makeBrowserPairingVerifier()
            let response = try await client.startBrowserPairing(
                endpoint: endpoint.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
                deviceName: Host.current().localizedName ?? "Nemo Mac",
                codeChallenge: codeChallengeS256(verifier)
            )
            guard let url = URL(string: response.pairUrl) else {
                status = .failed("Agent returned an invalid pairing URL.")
                return
            }
            NSWorkspace.shared.open(url)
            status = .loading
            browserPairingTask?.cancel()
            browserPairingTask = Task { [weak self] in
                await self?.pollBrowserPairing(
                    endpoint: endpoint,
                    deviceCode: response.deviceCode,
                    codeVerifier: verifier,
                    expiresAt: response.expiresAt,
                    intervalSeconds: response.intervalSeconds
                )
            }
        } catch let error as TransportError {
            status = transportStatus(from: error)
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    func handleSetupURL(_ url: URL) async {
        guard url.scheme == "nemo", url.host(percentEncoded: false) == "pair" else {
            return
        }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let endpoint = components?.queryItems?.first(where: { $0.name == "endpoint" })?.value ?? ""
        let id = components?.queryItems?.first(where: { $0.name == "id" })?.value ?? ""
        let code = components?.queryItems?.first(where: { $0.name == "code" })?.value ?? ""
        await pair(endpointText: endpoint, id: id, code: code)
    }

    func forgetCredential() {
        browserPairingTask?.cancel()
        try? keychain.deleteCredential(account: Self.credentialAccount)
        credential = nil
        serverMeta = nil
        apps = []
        status = .failed("Missing or invalid credential.")
    }

    func useDiscoveredAgent(_ agent: DiscoveredAgent) {
        profile.endpointURL = agent.endpoint.absoluteString
        manualPairingEndpoint = agent.endpoint.absoluteString
    }

    private func pair(endpointText: String, id: String, code: String) async {
        guard let endpoint = normalizedEndpoint(from: endpointText) else {
            status = .failed("Enter a valid endpoint URL.")
            return
        }
        let cleanId = id.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanCode = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanId.isEmpty, !cleanCode.isEmpty else {
            status = .failed("Pairing id and code are required.")
            return
        }

        status = .loading
        let client = NemoClient(endpoint: endpoint, credential: nil)
        do {
            let response = try await client.exchangePairing(id: cleanId, code: cleanCode, deviceName: Host.current().localizedName ?? "Nemo Mac")
            guard response.server.apiVersion == "1" else {
                status = .failed("Unsupported agent API version \(response.server.apiVersion).")
                return
            }
            try keychain.saveCredential(response.credential, account: Self.credentialAccount)
            credential = response.credential
            profile.endpointURL = endpoint.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            if profile.displayName == NemoProfile.default.displayName {
                profile.displayName = response.server.host
            }
            pairingId = ""
            pairingCode = ""
            await refresh()
        } catch let error as TransportError {
            status = transportStatus(from: error)
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    private func pollBrowserPairing(
        endpoint: URL,
        deviceCode: String,
        codeVerifier: String,
        expiresAt: String,
        intervalSeconds: Double
    ) async {
        let client = NemoClient(endpoint: endpoint, credential: nil)
        let deadline = Self.parseServerDate(expiresAt) ?? Date().addingTimeInterval(120)
        let deviceName = Host.current().localizedName ?? "Nemo Mac"

        while !Task.isCancelled && Date() < deadline {
            do {
                let response = try await client.exchangeBrowserPairing(
                    deviceCode: deviceCode,
                    codeVerifier: codeVerifier,
                    deviceName: deviceName
                )
                guard response.server.apiVersion == "1" else {
                    status = .failed("Unsupported agent API version \(response.server.apiVersion).")
                    return
                }
                try keychain.saveCredential(response.credential, account: Self.credentialAccount)
                credential = response.credential
                profile.endpointURL = endpoint.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                if profile.displayName == NemoProfile.default.displayName {
                    profile.displayName = response.server.host
                }
                await refresh()
                return
            } catch TransportError.api(_, "PAIRING_AUTHORIZATION_PENDING", _) {
                try? await Task.sleep(for: .seconds(max(1, intervalSeconds)))
            } catch TransportError.url(let error) where error.code == .cancelled || Task.isCancelled {
                return
            } catch let error as TransportError {
                if Task.isCancelled {
                    return
                }
                status = transportStatus(from: error)
                return
            } catch {
                if Task.isCancelled {
                    return
                }
                status = .failed(error.localizedDescription)
                return
            }
        }

        if !Task.isCancelled {
            status = .failed("Pairing request expired.")
        }
    }

    private func runRefreshLoop() async {
        while !Task.isCancelled {
            let seconds = max(10, profile.refreshIntervalSeconds)
            try? await Task.sleep(for: .seconds(seconds))
            await refresh()
        }
    }

    private func normalizedEndpoint(from text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let url = URL(string: trimmed), url.scheme != nil, url.host != nil else {
            return nil
        }
        return url
    }

    private func transportStatus(from error: TransportError) -> ConnectionStatus {
        return .failed(error.localizedDescription)
    }

    private static func parseServerDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) {
            return date
        }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }

    private func makeBrowserPairingVerifier() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            throw PairingCryptoError.randomFailed
        }
        return Data(bytes).base64URLEncodedString()
    }

    private func codeChallengeS256(_ verifier: String) -> String {
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return Data(digest).base64URLEncodedString()
    }

    private func saveProfile() {
        if let data = try? JSONEncoder().encode(profile) {
            UserDefaults.standard.set(data, forKey: Self.profileDefaultsKey)
        }
    }

    private static func loadProfile() -> NemoProfile {
        guard let data = UserDefaults.standard.data(forKey: profileDefaultsKey),
              let profile = try? JSONDecoder().decode(NemoProfile.self, from: data) else {
            return .default
        }
        return profile
    }

    private static let profileDefaultsKey = "NemoProfile"
    private static let credentialAccount = "read-credential"
}

private enum PairingCryptoError: LocalizedError {
    case randomFailed

    var errorDescription: String? {
        "Unable to create a pairing verifier."
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
