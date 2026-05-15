# Daily Driver Polish

Delete this file when this slice is complete.

## Goal

Make Nemo useful as a day-to-day menu bar status utility after the MVP works.

## Work

- Add app detail view:
  - URLs.
  - Process status.
  - Ports.
  - HTTPS state.
  - Recent logs.
  - Recent events.
- Add default refresh behavior:
  - Metadata and app list every 5 minutes.
  - App status every 60 seconds.
  - Logs on demand.
  - Events every 5 minutes or on demand.
- Prevent overlapping refreshes.
- Add "Open URL".
- Add launch at login.
- Add multiple profiles.
- Add pinned apps.
- Add cached last-known state for offline display.
- Add notifications on status changes.
- Add simple search if app count grows.
- Add certificate pinning or custom CA support if self-hosted TLS requires it.

## Done When

- Nemo is useful without opening the preferences window.
- Background refresh is predictable and does not block the menu UI.
- Offline or failing endpoints retain a useful last-known display.
