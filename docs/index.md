# Nemo Plan Index

This is the durable index for Nemo. Actionable work is split into task docs in
`docs/tasks/`. Delete each task doc when that slice is complete.

## Product Shape

Nemo is a lightweight macOS menu bar app for monitoring any reachable Dokku
instance through a small read-only sidecar service.

The external product name is Nemo. Dokku is the integration target and should
appear in technical implementation details, not in public product, app,
credential, or route names.

## Background

Nemo should answer a few operational questions quickly from the macOS menu bar:

- Is the host reachable?
- Are my Dokku apps running?
- Which URLs are live?
- Is HTTPS active?
- What changed recently?
- What do recent logs show?

The app should feel like a small status utility, not a hosted control plane or
full dashboard. The preferred architecture is:

```text
Nemo MenuBarExtra UI
  -> typed client models
  -> HTTP JSON transport
  -> nemo-agent on the Dokku host
  -> read-only Dokku command adapter
  -> dokku CLI / host status commands
```

The sidecar is intentionally a tiny Bun/TypeScript service compiled to native
Linux binaries. The target host should not need Node.js, npm, or a source
checkout to run it. The macOS app talks to a versioned JSON API and stores
paired credentials in macOS Keychain.

Remote access is a transport problem, not Nemo's auth system. The agent binds
to `127.0.0.1` by default. If users want remote access, they explicitly expose a
narrow route through a reverse proxy, Tailscale Serve, or a user-managed SSH
tunnel. Nemo still authenticates requests with paired bearer credentials.

The first product version is read-only. Write actions such as restarts,
rebuilds, or certificate renewals are intentionally out of scope until the
read-only status workflow is stable and useful.

## Current Status

Done:

- Root Git repository is active.
- Bun/TypeScript `nemo-agent` sidecar exists under `src/`.
- CLI is split into one command file per command under `src/agent/commands/`.
- Commands exist for `serve`, `init`, `doctor`, `status`, `pair`, and
  `credential`.
- Sidecar state uses `bun:sqlite`.
- Pairing sessions are short-lived, single-use, hashed, attempt-limited, and
  revocable.
- Paired bearer credentials are hashed server-side with a local server secret.
- `Bun.serve()` uses route literals, with route-scoped middleware in
  `src/agent/http.ts`.
- Implemented endpoints:
  - `GET /v1/health`
  - `POST /v1/pairing/exchange`
  - `GET /v1/meta`
  - `GET /v1/platform/version`
  - `GET /v1/apps`
  - `GET /v1/apps/:app`
  - `GET /v1/apps/:app/logs`
  - `GET /v1/events`
- Dokku command execution is allowlisted, timeout-bound, output-capped, and
  concurrency-limited.
- Fast Bun tests and a real Dokku Docker integration test run through
  `bun test`.
- Linux x64 and Linux arm64 compile scripts exist.
- Agent host install scaffolding exists for restrictive config/state layout and
  a systemd unit.
- `doctor` reports pass/warn/fail across agent binary metadata, host state,
  service artifacts, systemd posture, listener binding, Dokku discovery,
  read-command access, and service database readability.
- Reverse proxy, Tailscale Serve, SSH tunnel, HTTPS, and first packaging
  direction are documented in `docs/exposure-and-packaging.md`.

Not done:

- Native macOS menu bar app beyond the starter Xcode scaffold.
- App detail, logs/events UI, refresh strategy, pinned apps, notifications,
  optional SSH transport, and optional write actions.

## Active Task Docs

Work these roughly in order:

1. [macOS menu bar MVP](tasks/04-macos-menubar-mvp.md)
2. [Daily driver polish](tasks/05-daily-driver-polish.md)
3. [Optional SSH transport](tasks/06-optional-ssh-transport.md)
4. [Optional write actions](tasks/07-optional-write-actions.md)

## Guardrails

- Start read-only. Do not add write actions until the read dashboard is stable.
- Do not expose arbitrary shell execution.
- Do not store SSH private keys or DNS provider credentials.
- Do not require Tailscale, a tailnet, local SSH agent, or 1Password.
- Bind the sidecar to `127.0.0.1` by default.
- Remote exposure is user-owned through a reverse proxy, Tailscale Serve rule,
  or SSH tunnel.
- Require HTTPS for non-loopback app connections by default.
- Store app-side secrets in macOS Keychain.
- Keep read and write scopes separate if write actions are added later.
