//
//  NemoApp.swift
//  Nemo
//
//  Created by Omar Estrella on 5/14/26.
//

import AppKit
import SwiftUI

@main
struct NemoApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  @State private var agentSession: AgentSession

  init() {
    let model = AgentSession()
    _agentSession = State(initialValue: model)
    AppDelegate.model = model
    AppDelegate.openURLHandler = { url in
      Task { @MainActor in
        await model.handleSetupURL(url)
      }
    }
    Task { @MainActor in
      await model.start()
    }
  }

  var body: some Scene {
    MenuBarExtra {
      MainView(model: agentSession)
    } label: {
      Image("MenuBarIcon")
        .renderingMode(.template)
        .accessibilityLabel("Nemo")
    }
    .menuBarExtraStyle(.window)

    Settings {
      SettingsView(model: agentSession)
    }
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  static var openURLHandler: ((URL) -> Void)?
  static weak var model: AgentSession?
  #if DEBUG
    private var debugWindow: NSWindow?
  #endif

  func application(_ application: NSApplication, open urls: [URL]) {
    urls.forEach { Self.openURLHandler?($0) }
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    #if DEBUG
      guard let model = Self.model else {
        return
      }
      let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 460, height: 480),
        styleMask: [.titled, .closable, .resizable],
        backing: .buffered,
        defer: false
      )
      window.title = "Nemo Debug"
      window.contentView = NSHostingView(rootView: MainView(model: model))
      window.center()
      window.makeKeyAndOrderFront(nil)
      debugWindow = window
    #endif
  }
}
