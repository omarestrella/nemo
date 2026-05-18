import SwiftUI

struct SettingsView: View {
  @Bindable var model: AgentSession

  var body: some View {
    TabView {
      Form {
        Section {
          LabeledContent("Refresh") {
            HStack {
              Slider(value: $model.profile.refreshIntervalSeconds, in: 10...300, step: 5)
              Text("\(Int(model.profile.refreshIntervalSeconds)) sec")
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .frame(width: 54, alignment: .trailing)
            }
          }
        }
      }
      .formStyle(.grouped)
      .padding()
      .tabItem {
        Label("General", systemImage: "gearshape")
      }

      Form {
        Section("Current Pairing") {
          if model.hasCredential {
            HStack {
              VStack(alignment: .leading, spacing: 2) {
                Text(model.serverMeta?.host ?? URL(string: model.profile.endpointURL)?.host(percentEncoded: false) ?? "Paired host")
                  .fontWeight(.medium)
                Text(model.profile.endpointURL)
                  .font(.caption)
                  .foregroundStyle(.secondary)
              }
              Spacer()
              Text(model.status == .ready ? "Connected" : "Paired")
                .font(.caption)
                .foregroundStyle(model.status == .ready ? .green : .secondary)
            }
          } else {
            Text("No paired host.")
              .foregroundStyle(.secondary)
          }
        }

        Section("Discovered Hosts") {
          if model.discoveredAgents.isEmpty {
            Text("No hosts found.")
              .foregroundStyle(.secondary)
          } else {
            ForEach(model.discoveredAgents) { agent in
              HStack {
                VStack(alignment: .leading, spacing: 2) {
                  Text(agent.name)
                    .fontWeight(.medium)
                  Text(agent.endpoint.absoluteString)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Use") {
                  model.useDiscoveredAgent(agent)
                }
              }
            }
          }
        }

        Section("Manual Pairing") {
          LabeledContent("Endpoint") {
            TextField("Endpoint URL", text: $model.manualPairingEndpoint)
              .labelsHidden()
          }
          LabeledContent("Pairing ID") {
            TextField("Pairing ID", text: $model.pairingId)
              .labelsHidden()
          }
          LabeledContent("Pairing code") {
            TextField("Pairing code", text: $model.pairingCode)
              .labelsHidden()
          }
        }

        HStack {
          Spacer()
          Button {
            model.forgetCredential()
          } label: {
            Label("Forget Credential", systemImage: "key.slash")
          }
          .disabled(!model.hasCredential)

          Button {
            Task { await model.pairManually() }
          } label: {
            Label("Pair", systemImage: "link.badge.plus")
          }
          .buttonStyle(.borderedProminent)
        }
      }
      .formStyle(.grouped)
      .padding()
      .tabItem {
        Label("Pairing", systemImage: "link")
      }

      Form {
        Section {
          LabeledContent("Connection", value: model.status.message)
          if let meta = model.serverMeta {
            LabeledContent("Agent", value: meta.agentVersion)
            LabeledContent("API", value: meta.apiVersion)
            LabeledContent("Platform", value: meta.platformVersion ?? meta.platform)
          }
        }
      }
      .formStyle(.grouped)
      .padding()
      .tabItem {
        Label("Status", systemImage: "info.circle")
      }
    }
    .frame(width: 520, height: 340)
  }
}

#Preview {
  SettingsView(model: AgentSession())
}
