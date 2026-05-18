import Foundation
import SwiftUI

struct AppEventsView: View {
  @Bindable var model: AgentSession
  let app: AppSummary

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      if model.isLoadingEvents {
        DetailLoadingText("Loading events...")
      } else if let error = model.platformEventsError {
        DetailEmptyText(error)
      } else if let response = model.platformEvents {
        if response.status == "unavailable" {
          DetailEmptyText(response.message ?? "Events unavailable.")
        } else if scopedEvents(from: response).isEmpty {
          DetailEmptyText("No recent events.")
        } else {
          ScrollView {
            VStack(alignment: .leading, spacing: 10) {
              ForEach(scopedEvents(from: response).prefix(30)) { event in
                HStack(alignment: .top, spacing: 8) {
                  Circle()
                    .fill(.secondary.opacity(0.45))
                    .frame(width: 6, height: 6)
                    .padding(.top, 5)
                  VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 5) {
                      Text(event.action ?? "event")
                        .font(.caption.weight(.semibold))
                      if let app = event.app {
                        Text(app)
                          .font(.caption2)
                          .foregroundStyle(.secondary)
                      }
                      Spacer()
                      if let timestamp = event.timestampText {
                        Text(timestamp)
                          .font(.caption2)
                          .foregroundStyle(.secondary)
                      }
                    }
                    Text(event.message.isEmpty ? event.raw : event.message)
                      .font(.caption)
                      .foregroundStyle(.secondary)
                      .lineLimit(2)
                  }
                }
              }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
          }
          .background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: 7))
        }
      } else {
        Button {
          Task { await model.loadEvents() }
        } label: {
          Label("Load recent events", systemImage: "arrow.down.circle")
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .font(.caption)
        .padding(.vertical, 3)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .onAppear {
      guard model.platformEvents == nil else {
        return
      }
      Task { await model.loadEvents() }
    }
  }

  private func scopedEvents(from response: PlatformEventsResponse) -> [PlatformEvent] {
    let appEvents = response.events.filter { $0.app == app.name }
    return appEvents.isEmpty ? response.events : appEvents
  }
}

#Preview {
  AppEventsView(
    model: .previewForAppEvents,
    app: .previewEventsApp
  )
  .padding()
  .frame(width: 460, height: 480)
}

private extension AgentSession {
  static var previewForAppEvents: AgentSession {
    let session = AgentSession()
    session.status = .ready
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
          app: AppSummary.previewEventsApp.name,
          args: []
        ),
        PlatformEvent(
          index: 1,
          raw: "config:set workouts",
          message: "Config changed",
          timestamp: "2026-05-17T15:10:00Z",
          timestampText: "3:10 PM",
          host: "rpi",
          source: "dokku",
          pid: nil,
          action: "config",
          app: AppSummary.previewEventsApp.name,
          args: []
        ),
        PlatformEvent(
          index: 2,
          raw: "ps:restart workouts",
          message: "Restarted",
          timestamp: "2026-05-17T14:02:00Z",
          timestampText: "2:02 PM",
          host: "rpi",
          source: "dokku",
          pid: nil,
          action: "restart",
          app: AppSummary.previewEventsApp.name,
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
  static var previewEventsApp: AppSummary {
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
