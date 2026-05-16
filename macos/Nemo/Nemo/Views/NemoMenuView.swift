import AppKit
import SwiftUI

struct NemoMenuView: View {
    @Bindable var model: AgentSession

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            statusBanner

            if !model.hasCredential {
                unpairedState
            } else if model.apps.isEmpty {
                ContentUnavailableView("No apps", systemImage: "square.stack.3d.up.slash", description: Text("Refresh to load app status."))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
            } else {
                appList
            }

            Divider()

            HStack {
                Button {
                    Task { await model.refresh() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .disabled(model.status == .loading)

                Spacer()

                SettingsLink {
                    Label("Settings", systemImage: "gearshape")
                }

                Button("Quit") {
                    NSApplication.shared.terminate(nil)
                }
            }
        }
        .padding(16)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 3) {
                Text(model.profile.displayName.isEmpty ? "Nemo" : model.profile.displayName)
                    .font(.headline)
                Text(model.serverMeta?.host ?? model.profile.endpointURL)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer()
            Text(lastRefreshText)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var statusBanner: some View {
        Label {
            Text(model.status.message)
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: statusIcon)
                .foregroundStyle(statusColor)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(statusColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
    }

    private var unpairedState: some View {
        VStack(spacing: 12) {
            ContentUnavailableView("Not paired", systemImage: "link.badge.plus", description: Text("Pair this device with a Nemo agent to load app status."))
                .frame(maxWidth: .infinity)
            Button {
                Task { await model.startBrowserPairing() }
            } label: {
                Label("Begin Pairing", systemImage: "safari")
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(model.status == .loading)
        }
        .padding(.vertical, 8)
    }

    private var appList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(model.apps) { app in
                    AppRow(app: app)
                    if app.id != model.apps.last?.id {
                        Divider()
                    }
                }
            }
        }
        .frame(maxHeight: 360)
    }

    private var lastRefreshText: String {
        guard let lastRefresh = model.lastRefresh else {
            return "Never"
        }
        return lastRefresh.formatted(date: .omitted, time: .shortened)
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
}

private struct AppRow: View {
    let app: AppSummary

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Circle()
                .fill(statusColor)
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
            Text(statusText)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 9)
    }

    private var statusText: String {
        switch app.running {
        case .some(true):
            "Running"
        case .some(false):
            "Stopped"
        case .none:
            "Unknown"
        }
    }

    private var statusColor: Color {
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

#Preview {
    NemoMenuView(model: AgentSession())
}
