# dokku-nemo

Nemo is a macOS menu bar utility backed by a small read-only Dokku sidecar.

## Agent development

Install dependencies:

```bash
bun install
```

Run the agent locally with state in `.nemo-agent/`:

```bash
bun run dev
```

Useful commands:

```bash
bun src/index.ts init --state-dir .nemo-agent
bun src/index.ts doctor --fix --state-dir .nemo-agent
bun src/index.ts pair start --state-dir .nemo-agent --name "Dev Mac" --endpoint http://127.0.0.1:7331
bun src/index.ts serve --state-dir .nemo-agent
```

Exposure and installation notes are in
[docs/exposure-and-packaging.md](docs/exposure-and-packaging.md). The supported
remote shapes are Bonjour-discovered LAN access for trusted local networks, a
narrow HTTPS reverse-proxy route, Tailscale Serve, or a user-managed SSH tunnel.

Run tests and compile Linux binaries:

```bash
bun test
bun run test:docker
bun run build:linux-x64
bun run build:linux-arm64
```

The Docker integration test runs as part of `bun test`. It starts a disposable
`dokku/dokku` container, copies the compiled agent into it, and exercises
pairing plus the live HTTP API against real Dokku commands. Use
`bun run test:docker` to run only that test. It requires Docker and may take
several minutes the first time it pulls the Dokku image.

The installed systemd service runs as the dedicated `nemo-agent` user. Root is
only required for install/repair of host artifacts and for the constrained
Dokku read helper invoked by the service.

The agent binds to `0.0.0.0` by default and exposes `/v1/health`,
`/v1/meta`, `/v1/platform/version`, `/v1/apps`, and `/v1/apps/{app}`.
Authenticated clients can also call `/v1/apps/{app}/logs` and `/v1/events`.
