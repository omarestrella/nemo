<p align="center">
  <img src="assets/images/nemo-app-icon.png" alt="Nemo logo" width="96" height="96">
</p>

<h1 align="center">Nemo</h1>

<p align="center">
  <strong>A macOS menu bar for keeping an eye on your Dokku apps.</strong>
</p>

<p align="center">
  Nemo pairs a small read-only agent on your Dokku host with a native macOS menu
  bar app, so app status, URLs, HTTPS state, logs, and platform events are only
  a click away.
</p>

## Status

Nemo is early open-source software. The agent and pairing API are usable, the
macOS client is under active development, and release packaging is set up for
signed Homebrew cask distribution once Apple signing credentials are configured.

## Screenshots

<p align="center">
  <img src="docs/assets/screenshots/nemo-menu.png" alt="Nemo macOS menu showing app status, HTTPS state, logs, events, and links" width="485">
</p>

## Install

### macOS App

The Homebrew cask lives in this repository, so tap the source repo directly:

```sh
brew tap omarestrella/nemo https://github.com/omarestrella/nemo
brew install --cask omarestrella/nemo/nemo
```

The cask downloads `Nemo.zip` from the latest GitHub release.

### Dokku Host Agent

On the Dokku host, install the latest released Linux agent and systemd
integration:

```sh
curl -fsSL https://omarestrella.github.io/nemo/install.sh | sh
```

The installer detects `x86_64` and `arm64` Linux hosts, installs
`/usr/local/bin/nemo-agent`, creates the dedicated `nemo-agent` service account,
installs the constrained Dokku wrapper, enables the systemd service, and runs
`doctor`.

Useful installer environment variables:

```sh
curl -fsSL https://omarestrella.github.io/nemo/install.sh | \
  NEMO_VERSION=v0.1.0 NEMO_HOST=127.0.0.1 NEMO_INSTALL_ONLY=1 sh
```

- `NEMO_VERSION`: release tag to install. Defaults to the latest release.
- `NEMO_HOST`: listener host for `nemo-agent init`. Defaults to `0.0.0.0`.
- `NEMO_PORT`: listener port. Defaults to `7331`.
- `NEMO_STATE_DIR`: state directory. Defaults to `/var/lib/nemo-agent`.
- `NEMO_INSTALL_ONLY=1`: install the binary without initializing host artifacts.

### Pair Nemo

Start a short-lived pairing session on the Dokku host:

```sh
nemo-agent pair start \
  --name "MacBook" \
  --endpoint http://dokku-host.local:7331
```

Enter the pairing ID and code in the macOS app. Nemo stores the returned
credential in macOS Keychain.

## Security Model

The long-running agent runs as the dedicated `nemo-agent` user. Root is only
required for install or repair of host artifacts and for the constrained Dokku
wrapper invoked by the service.

The default paired credential is read-only. Requests are authenticated with
paired bearer credentials, and untrusted remote access should go through HTTPS,
Tailscale Serve, or a user-managed SSH tunnel rather than exposing the agent
directly to the public internet.

## Development

Install dependencies:

```sh
bun install
```

Run the agent locally with state in `.nemo-agent/`:

```sh
bun run dev
```

Useful commands:

```sh
bun src/index.ts init --state-dir .nemo-agent
bun src/index.ts doctor --fix --state-dir .nemo-agent
bun src/index.ts pair start --state-dir .nemo-agent --name "Dev Mac" --endpoint http://127.0.0.1:7331
bun src/index.ts serve --state-dir .nemo-agent
```

Run tests and compile Linux binaries:

```sh
bun test
bun run test:docker
bun run build:linux-x64
bun run build:linux-arm64
```

The Docker integration test starts a disposable `dokku/dokku` container, copies
the compiled agent into it, and exercises pairing plus the live HTTP API against
real Dokku commands. Use `bun run test:docker` to run only that test. It
requires Docker and may take several minutes the first time it pulls the Dokku
image.

## Releases

GitHub releases are created from `v*` tags. A release publishes:

- `Nemo.zip`: signed and notarized macOS app for the Homebrew cask.
- `nemo-agent-linux-x64`: Linux x64 agent binary.
- `nemo-agent-linux-arm64`: Linux arm64 agent binary.
- `SHA256SUMS`: checksums for release assets.

Release setup and Apple signing details are in
[docs/releasing.md](docs/releasing.md).

## More Docs

- [Exposure and packaging](docs/exposure-and-packaging.md)
- [Releasing](docs/releasing.md)
- [Project website](https://omarestrella.github.io/nemo/)
- [Project plan index](docs/index.md)

## License

A license has not been declared yet. Add one before accepting external
contributions.
