import SwiftUI

struct SettingsView: View {
    @Bindable var model: AgentSession

    var body: some View {
        Form {
            Section("Profile") {
                TextField("Display name", text: $model.profile.displayName)
                TextField("Endpoint URL", text: $model.profile.endpointURL)
                Picker("Auth method", selection: $model.profile.authMethod) {
                    ForEach(AuthMethod.allCases) { method in
                        Text(method.rawValue).tag(method)
                    }
                }
                HStack {
                    Slider(value: $model.profile.refreshIntervalSeconds, in: 10...300, step: 5)
                    Text("\(Int(model.profile.refreshIntervalSeconds))s")
                        .frame(width: 44, alignment: .trailing)
                }
            }

            Section("Pairing") {
                if !model.discoveredAgents.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Discovered agents")
                            .font(.subheadline.weight(.semibold))
                        ForEach(model.discoveredAgents) { agent in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(agent.name)
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
                    .padding(.vertical, 4)
                }
                TextField("Endpoint URL", text: $model.manualPairingEndpoint)
                TextField("Pairing ID", text: $model.pairingId)
                TextField("Pairing code", text: $model.pairingCode)
                HStack {
                    Button {
                        Task { await model.pairManually() }
                    } label: {
                        Label("Pair", systemImage: "link.badge.plus")
                    }
                    .buttonStyle(.borderedProminent)

                    Button {
                        model.forgetCredential()
                    } label: {
                        Label("Forget Credential", systemImage: "key.slash")
                    }
                    .disabled(!model.hasCredential)

                    Spacer()
                }
            }

            Section("Status") {
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
    }
}

#Preview {
    SettingsView(model: AgentSession())
}
