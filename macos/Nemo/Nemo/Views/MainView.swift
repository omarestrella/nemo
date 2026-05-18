import AppKit
import SwiftUI

struct MainView: View {
  @Bindable var model: AgentSession
  @State private var navigation = NemoMenuNavigation()
  private let menuWidth: CGFloat = 460
  private let menuHeight: CGFloat = 480

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 10) {
        if canGoBack {
          Button {
            goBack()
          } label: {
            Label(screenBackTitle ?? "Back", systemImage: "chevron.left")
              .labelStyle(.titleAndIcon)
          }
          .buttonStyle(.accessoryBar)
          .help("Back")
        }

        Text(screenTitle)
          .font(.headline)
          .lineLimit(1)
          .truncationMode(.middle)

        Spacer(minLength: 12)

        if showsAppHeaderActions {
          HStack(spacing: 6) {
            Button {
              refreshScreen()
            } label: {
              Label(rootRefreshTitle, systemImage: "arrow.clockwise")
                .labelStyle(.iconOnly)
            }
            .help(rootRefreshTitle)
            .disabled(model.status == .loading)

            SettingsLink {
              Label("Settings", systemImage: "gearshape")
                .labelStyle(.iconOnly)
            }
            .help("Settings")

            Button {
              NSApplication.shared.terminate(nil)
            } label: {
              Label("Quit Nemo", systemImage: "power")
                .labelStyle(.iconOnly)
            }
            .help("Quit Nemo")
          }
          .buttonStyle(.bordered)
          .controlSize(.regular)
        }
      }
      .padding(.horizontal, 16)
      .frame(height: 58)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(.background)

      Divider()

      Group {
        switch resolvedScreen {
        case .root(let expandedApp):
          VStack(alignment: .leading, spacing: 10) {
            if !showsApps {
              VStack(alignment: .leading, spacing: 10) {
                if model.discoveredAgents.isEmpty {
                  VStack(alignment: .leading, spacing: 8) {
                    Text("No hosts found")
                      .font(.callout.weight(.semibold))
                    Text("Make sure a Nemo agent is running on this network, then scan again.")
                      .font(.caption)
                      .foregroundStyle(.secondary)
                      .fixedSize(horizontal: false, vertical: true)
                  }
                  .frame(maxWidth: .infinity, alignment: .leading)
                  .padding(12)
                  .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
                } else {
                  ForEach(model.discoveredAgents) { agent in
                    VStack(alignment: .leading, spacing: 10) {
                      HStack(alignment: .top, spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                          Text(agent.name)
                            .font(.callout.weight(.semibold))
                            .lineLimit(1)
                          Text(agentEndpointText(agent))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        }
                        Spacer()
                        Text("Unpaired")
                          .font(.caption2.weight(.medium))
                          .foregroundStyle(.orange)
                          .padding(.horizontal, 7)
                          .padding(.vertical, 3)
                          .background(.orange.opacity(0.12), in: Capsule())
                      }

                      HStack(spacing: 8) {
                        Label {
                          Text("Agent reachable")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        } icon: {
                          Image(systemName: "checkmark.circle.fill")
                            .font(.caption)
                            .foregroundStyle(.green)
                        }
                        .labelStyle(.titleAndIcon)

                        Label {
                          Text("Approval needed")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        } icon: {
                          Image(systemName: "key.fill")
                            .font(.caption)
                            .foregroundStyle(.orange)
                        }
                        .labelStyle(.titleAndIcon)
                      }

                      Button {
                        model.useDiscoveredAgent(agent)
                        Task { await model.startBrowserPairing() }
                      } label: {
                        Label("Pair this Mac", systemImage: "safari")
                          .frame(maxWidth: .infinity)
                      }
                      .buttonStyle(.borderedProminent)
                      .disabled(model.status == .loading)
                    }
                    .padding(.vertical, 4)

                    if agent.id != model.discoveredAgents.last?.id {
                      Divider()
                    }
                  }
                }

                if shouldShowPairingStatus {
                  Label {
                    Text(model.status.message)
                      .font(.caption)
                      .fixedSize(horizontal: false, vertical: true)
                  } icon: {
                    Image(systemName: statusIcon)
                      .foregroundStyle(statusColor)
                  }
                  .padding(9)
                  .frame(maxWidth: .infinity, alignment: .leading)
                  .background(statusColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
                }
              }
            } else if model.apps.isEmpty {
              VStack(alignment: .leading, spacing: 8) {
                Text("No apps")
                  .font(.callout.weight(.semibold))
                Text("Refresh to load app status from \(model.serverMeta?.host ?? "the agent").")
                  .font(.caption)
                  .foregroundStyle(.secondary)
                  .fixedSize(horizontal: false, vertical: true)
              }
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(12)
              .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
            } else {
              ScrollView {
                LazyVStack(spacing: 0) {
                  ForEach(model.apps) { app in
                    let isExpanded = expandedApp?.name == app.name
                    VStack(alignment: .leading, spacing: 0) {
                      Button {
                        navigation.toggleAppExpansion(app)
                      } label: {
                        HStack(alignment: .center, spacing: 10) {
                          Circle()
                            .fill(appStatusColor(app))
                            .frame(width: 9, height: 9)
                          VStack(alignment: .leading, spacing: 3) {
                            HStack {
                              Text(app.name)
                                .font(.callout.weight(.semibold))
                                .lineLimit(1)
                              if app.httpsActive == true {
                                Image(systemName: "lock.fill")
                                  .font(.caption)
                                  .foregroundStyle(.green)
                              } else if app.httpsActive == false {
                                Image(systemName: "lock.slash")
                                  .font(.caption)
                                  .foregroundStyle(.orange)
                              }
                            }
                            Text(app.primaryURL ?? "No URL")
                              .font(.caption)
                              .foregroundStyle(.secondary)
                              .lineLimit(1)
                              .truncationMode(.middle)
                          }
                          Spacer()
                          Text(appStatusSummary(app))
                            .font(.caption)
                            .foregroundStyle(appStatusSummaryColor(app))
                            .lineLimit(1)
                          Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                        }
                        .contentShape(Rectangle())
                        .padding(.horizontal, 8)
                        .padding(.vertical, 9)
                      }
                      .buttonStyle(.plain)

                      if isExpanded {
                        AppDetailView(model: model, app: app) {
                          navigation.showLogs(for: app)
                        } showEvents: {
                          navigation.showEvents(for: app)
                        }
                        .padding(.horizontal, 8)
                        .padding(.top, 6)
                        .padding(.bottom, 12)
                      }
                    }

                    if app.id != model.apps.last?.id {
                      Divider()
                    }
                  }
                }
              }
              .frame(maxHeight: .infinity)
            }
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        case .logs(let app):
          AppLogsView(model: model, app: app)
        case .events(let app):
          AppEventsView(model: model, app: app)
        case .unavailable(_, let message):
          VStack(alignment: .leading, spacing: 12) {
            DetailEmptyText(message)
            Spacer(minLength: 0)
          }
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 14)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
    .frame(width: menuWidth, height: menuHeight, alignment: .topLeading)
    .clipped()
    .onChange(of: showsApps) { _, enabled in
      guard !enabled else {
        return
      }
      navigation.showRoot()
    }
  }

  private var resolvedScreen: NemoMenuScreen {
    switch navigation.screen {
    case .root(let expandedApp):
      guard let expandedApp else {
        return .root(expandedApp: nil)
      }
      guard let current = model.app(named: expandedApp.name) else {
        return .root(expandedApp: nil)
      }
      return .root(expandedApp: current)
    case .unavailable:
      return navigation.screen
    case .logs(let app):
      guard let current = model.app(named: app.name) else {
        return .unavailable(title: "App unavailable", message: "\(app.name) is no longer in the app list.")
      }
      return .logs(current)
    case .events(let app):
      guard let current = model.app(named: app.name) else {
        return .unavailable(title: "App unavailable", message: "\(app.name) is no longer in the app list.")
      }
      return .events(current)
    }
  }

  private var screenTitle: String {
    switch resolvedScreen {
    case .root:
      rootTitle
    case .logs:
      "Logs"
    case .events:
      "Events"
    case .unavailable(let title, _):
      title
    }
  }

  private var screenBackTitle: String? {
    switch resolvedScreen {
    case .root:
      nil
    case .logs, .events, .unavailable:
      "Apps"
    }
  }

  private var canGoBack: Bool {
    if case .root = resolvedScreen {
      return false
    }
    return true
  }

  private var showsAppHeaderActions: Bool {
    guard case .root = resolvedScreen else {
      return false
    }
    return showsApps
  }

  private func goBack() {
    if case .unavailable = resolvedScreen {
      navigation.showRoot()
      return
    }
    navigation.goBack()
  }

  private var rootTitle: String {
    showsApps ? "Apps" : "Discovered Hosts"
  }

  private var rootRefreshTitle: String {
    showsApps ? "Refresh apps" : "Scan hosts"
  }

  private func refreshScreen() {
    switch resolvedScreen {
    case .root:
      if showsApps {
        Task { await model.refresh() }
      } else {
        model.scanForAgents()
      }
    case .logs(let app):
      Task { await model.loadLogs(for: app.name) }
    case .events:
      Task { await model.loadEvents() }
    case .unavailable:
      Task { await model.refresh() }
    }
  }

  private var showsApps: Bool {
    model.hasCredential || model.status == .ready
  }

  private var shouldShowPairingStatus: Bool {
    switch model.status {
    case .loading, .blocked, .failed:
      true
    case .idle, .ready:
      false
    }
  }

  private var statusIcon: String {
    switch model.status {
    case .ready:
      "checkmark.circle.fill"
    case .loading:
      "arrow.triangle.2.circlepath"
    case .blocked, .failed:
      "exclamationmark.triangle.fill"
    case .idle:
      "circle"
    }
  }

  private var statusColor: Color {
    switch model.status {
    case .ready:
      .green
    case .loading, .idle:
      .secondary
    case .blocked:
      .orange
    case .failed:
      .red
    }
  }

  private func agentEndpointText(_ agent: DiscoveredAgent) -> String {
    agent.endpoint.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
  }

  private func appStatusSummary(_ app: AppSummary) -> String {
    if app.running == false {
      return "Stopped"
    }
    if app.httpsActive == false {
      return "No TLS"
    }
    if app.running == true {
      return "Running"
    }
    return "Unknown"
  }

  private func appStatusSummaryColor(_ app: AppSummary) -> Color {
    if app.running == false {
      return .red
    }
    if app.httpsActive == false {
      return .orange
    }
    if app.running == true {
      return .green
    }
    return .secondary
  }

  private func appStatusColor(_ app: AppSummary) -> Color {
    switch app.running {
    case .some(true):
      .green
    case .some(false):
      .red
    case .none:
      .gray
    }
  }
}

@Observable
final class NemoMenuNavigation {
  var screen: NemoMenuScreen = .root(expandedApp: nil)

  func showRoot() {
    screen = .root(expandedApp: nil)
  }

  func toggleAppExpansion(_ app: AppSummary) {
    if case .root(let expandedApp) = screen, expandedApp?.name == app.name {
      screen = .root(expandedApp: nil)
    } else {
      screen = .root(expandedApp: app)
    }
  }

  func showLogs(for app: AppSummary) {
    screen = .logs(app)
  }

  func showEvents(for app: AppSummary) {
    screen = .events(app)
  }

  func goBack() {
    switch screen {
    case .root:
      break
    case .unavailable:
      screen = .root(expandedApp: nil)
    case .logs(let app), .events(let app):
      screen = .root(expandedApp: app)
    }
  }
}

enum NemoMenuScreen {
  case root(expandedApp: AppSummary?)
  case logs(AppSummary)
  case events(AppSummary)
  case unavailable(title: String, message: String)
}

#Preview("Discovered Hosts") {
  MainView(model: .previewDiscoveredHosts)
}

#Preview("No Hosts") {
  MainView(model: .previewNoHosts)
}

#Preview("Apps") {
  MainView(model: .previewApps)
}

private extension AgentSession {
  static var previewDiscoveredHosts: AgentSession {
    let session = AgentSession()
    session.status = .idle
    session.discoveredAgents = [
      DiscoveredAgent(
        name: "rpi",
        host: "rpi.local",
        port: 7331,
        path: "/",
        endpoint: URL(string: "http://rpi.local:7331")!
      ),
      DiscoveredAgent(
        name: "staging",
        host: "staging.local",
        port: 7331,
        path: "/",
        endpoint: URL(string: "http://staging.local:7331")!
      ),
    ]
    return session
  }

  static var previewNoHosts: AgentSession {
    let session = AgentSession()
    session.status = .idle
    session.discoveredAgents = []
    return session
  }

  static var previewApps: AgentSession {
    let session = AgentSession()
    session.status = .ready
    session.serverMeta = ServerMeta(
      apiVersion: "1",
      agentVersion: "0.1.0",
      instanceId: "preview",
      host: "rpi",
      platform: "dokku",
      platformVersion: "0.38.5",
      capabilities: ["apps", "logs", "events"]
    )
    session.apps = [
      AppSummary(
        name: "workouts",
        urls: ["http://workouts.home.bitcreative.net"],
        running: true,
        deployed: true,
        processCount: 1,
        httpsActive: true,
        containerStatus: "running",
        ports: "http:80:5000",
        domains: ["workouts.home.bitcreative.net"]
      ),
      AppSummary(
        name: "nemo-staging",
        urls: ["http://nemo-staging.home.bitcreative.net"],
        running: false,
        deployed: true,
        processCount: 0,
        httpsActive: false,
        containerStatus: "exited",
        ports: nil,
        domains: ["nemo-staging.home.bitcreative.net"]
      ),
    ]
    return session
  }
}
