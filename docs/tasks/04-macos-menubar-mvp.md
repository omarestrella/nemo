# macOS Menu Bar MVP

Delete this file when this slice is complete.

## Goal

Turn the existing Xcode scaffold in `macos/Nemo` into a usable macOS menu bar
client for the sidecar API.

## Work

- Convert the SwiftUI scaffold into a `MenuBarExtra` app.
- Add profile settings:
  - Display name.
  - Endpoint URL.
  - Auth method.
  - Refresh interval.
  - Pinned/hidden apps later if needed.
- Implement setup URI and manual pairing:
  - `nemo://pair?endpoint=...&id=...&code=...`
  - Endpoint URL plus pairing code.
- Store paired credentials in macOS Keychain.
- Implement `HTTPJSONTransport`.
- Implement typed client models for server status and app summaries.
- Render a menu popover showing:
  - Server/profile name.
  - Last refresh time.
  - Manual refresh.
  - App list.
  - Running/stopped/unknown status.
  - HTTPS indicator.
  - Primary URL.
- Add basic error states:
  - Endpoint unreachable.
  - TLS/certificate failure.
  - Missing or invalid credential.
  - Agent reachable but platform command failed.
  - Unsupported agent version.

## Done When

- A fresh app can pair with a running sidecar.
- Relaunching the app uses the Keychain credential.
- The menu bar popover shows reachability and app status from the live API.
- Trusted LAN and loopback HTTP endpoints can be used for discovery and pairing.
