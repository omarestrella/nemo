import Foundation
import SwiftUI

struct AppDetailView: View {
  @Bindable var model: AgentSession
  let app: AppSummary
  let showLogs: () -> Void
  let showEvents: () -> Void

  var body: some View {
    HStack(spacing: 8) {
      Button {
        showLogs()
      } label: {
        VStack(spacing: 3) {
          Image(systemName: "terminal")
            .font(.body)
          Text("Logs")
            .font(.caption.weight(.medium))
        }
        .frame(maxWidth: .infinity, minHeight: 46)
      }
      .frame(maxWidth: .infinity)

      Button {
        showEvents()
      } label: {
        VStack(spacing: 3) {
          Image(systemName: "clock")
            .font(.body)
          Text("Events")
            .font(.caption.weight(.medium))
        }
        .frame(maxWidth: .infinity, minHeight: 46)
      }
      .frame(maxWidth: .infinity)

      if app.primaryURL != nil {
        Button {
          model.openPrimaryURL(for: app)
        } label: {
          VStack(spacing: 3) {
            Image(systemName: "globe")
              .font(.body)
            Text("Open")
              .font(.caption.weight(.medium))
          }
          .frame(maxWidth: .infinity, minHeight: 46)
        }
        .frame(maxWidth: .infinity)
      }
    }
    .buttonStyle(.bordered)
    .controlSize(.small)
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .onAppear {
      Task { await model.refreshApp(app.name) }
    }
  }
}

#Preview {
  AppDetailView(
    model: .previewForAppDetail,
    app: .previewDetailApp,
    showLogs: {},
    showEvents: {}
  )
  .padding()
  .frame(width: 460, height: 480)
}

private extension AgentSession {
  static var previewForAppDetail: AgentSession {
    let session = AgentSession()
    session.status = .ready
    session.lastRefresh = Date(timeIntervalSinceReferenceDate: 800_000_000)
    session.appLogs[AppSummary.previewDetailApp.name] = AppLogsResponse(
      status: "ok",
      app: AppSummary.previewDetailApp.name,
      lines: 100,
      logs: [
        LogLine(
          index: 0,
          raw: "2026-05-17T16:08:10Z web.1 Listening on port 5000",
          message: "web.1 Listening on port 5000",
          timestamp: "2026-05-17T16:08:10Z",
          timestampText: "4:08:10 PM",
          source: "web.1"
        ),
      ],
      truncated: false
    )
    session.platformEvents = PlatformEventsResponse(
      status: "ok",
      limit: 50,
      events: [
        PlatformEvent(
          index: 0,
          raw: "deploy workouts",
          message: "Deploy 9f3c2b7",
          timestamp: "2026-05-17T15:44:00Z",
          timestampText: "3:44 PM",
          host: "rpi",
          source: "dokku",
          pid: nil,
          action: "deploy",
          app: AppSummary.previewDetailApp.name,
          args: []
        ),
      ],
      truncated: false,
      retryable: nil,
      message: nil,
      raw: nil
    )
    return session
  }
}

private extension AppSummary {
  static var previewDetailApp: AppSummary {
    AppSummary(
      name: "workouts",
      urls: ["https://workouts.home.bitcreative.net"],
      running: true,
      deployed: true,
      processCount: 1,
      httpsActive: true,
      containerStatus: "running",
      ports: "http:80:5000",
      domains: ["workouts.home.bitcreative.net"]
    )
  }
}
