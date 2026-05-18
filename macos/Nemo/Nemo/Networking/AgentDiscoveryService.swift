import Foundation

struct DiscoveredAgent: Identifiable, Equatable {
  var id: String { endpoint.absoluteString }

  let name: String
  let host: String
  let port: Int
  let path: String
  let endpoint: URL
}

final class AgentDiscoveryService: NSObject {
  var onAgentsChanged: (([DiscoveredAgent]) -> Void)?

  private let browser = NetServiceBrowser()
  private var services: [NetService] = []
  private var agents: [DiscoveredAgent] = []

  override init() {
    super.init()
    browser.delegate = self
  }

  func start() {
    browser.searchForServices(ofType: "_nemo-agent._tcp.", inDomain: "local.")
  }

  func stop() {
    browser.stop()
    services.removeAll()
    agents.removeAll()
    notify()
  }

  private func update(service: NetService) {
    guard let agent = DiscoveredAgent(service: service) else {
      return
    }
    agents.removeAll { $0.id == agent.id || $0.name == agent.name }
    agents.append(agent)
    agents.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    notify()
  }

  private func remove(service: NetService) {
    agents.removeAll { $0.name == service.name }
    notify()
  }

  private func notify() {
    let agents = agents
    Task { @MainActor in
      onAgentsChanged?(agents)
    }
  }
}

extension AgentDiscoveryService: NetServiceBrowserDelegate {
  func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
    services.append(service)
    service.delegate = self
    service.resolve(withTimeout: 5)
  }

  func netServiceBrowser(_ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) {
    services.removeAll { $0 === service }
    remove(service: service)
  }
}

extension AgentDiscoveryService: NetServiceDelegate {
  func netServiceDidResolveAddress(_ sender: NetService) {
    update(service: sender)
  }

  func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) {
    remove(service: sender)
  }
}

private extension DiscoveredAgent {
  init?(service: NetService) {
    guard service.port > 0 else {
      return nil
    }
    let host = service.hostName?.trimmingCharacters(in: CharacterSet(charactersIn: ".")) ?? "\(service.name).local"
    let path = service.txtRecordValue(named: "path") ?? "/"
    let normalizedPath = path.hasPrefix("/") ? path : "/\(path)"
    var components = URLComponents()
    components.scheme = "http"
    components.host = host
    components.port = service.port
    components.path = normalizedPath == "/" ? "" : normalizedPath
    guard let endpoint = components.url else {
      return nil
    }
    self.init(name: service.name, host: host, port: service.port, path: normalizedPath, endpoint: endpoint)
  }
}

private extension NetService {
  func txtRecordValue(named name: String) -> String? {
    guard let data = txtRecordData(),
          let value = NetService.dictionary(fromTXTRecord: data)[name] else {
      return nil
    }
    return String(data: value, encoding: .utf8)
  }
}
