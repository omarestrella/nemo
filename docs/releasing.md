# Releasing

Nemo publishes two install surfaces from GitHub releases:

- `Nemo.zip`, the signed and notarized macOS app consumed by the Homebrew cask.
- `nemo-agent-linux-x64` and `nemo-agent-linux-arm64`, the Bun-compiled Linux
  agent binaries consumed by `install.sh`.

## Release Assets

Every `v*` release should contain:

```text
Nemo.zip
nemo-agent-linux-x64
nemo-agent-linux-arm64
SHA256SUMS
```

The root `install.sh` downloads the matching Linux binary from the latest
release by default. The `Casks/nemo.rb` cask downloads `Nemo.zip` from the
latest release.

## Project Website

The `Pages` workflow publishes a static project site to:

```text
https://omarestrella.github.io/nemo/
```

The workflow prepares a Pages artifact from `site/`, copies the shared app icon,
and exposes the root installer at:

```text
https://omarestrella.github.io/nemo/install.sh
```

Use the Pages URL for public install snippets.

## Apple Signing

Homebrew can install the cask without a separate tap repository because this
source repo contains `Casks/nemo.rb`. The app still needs Developer ID signing
and notarization so macOS users can launch it without Gatekeeper warnings.

Configure these GitHub repository secrets before pushing a release tag:

- `APPLE_CERTIFICATE_P12_BASE64`: base64-encoded Developer ID Application
  certificate and private key exported as a `.p12`.
- `APPLE_CERTIFICATE_PASSWORD`: password for the exported `.p12`.
- `APPLE_TEAM_ID`: Apple developer team ID.
- `APPLE_ID`: Apple ID used for notarization.
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password for notarization.
- `APPLE_KEYCHAIN_PASSWORD`: optional temporary CI keychain password.

The release workflow imports the certificate into a temporary keychain, builds a
Release archive, submits the zipped app to Apple's notary service with
`notarytool`, staples the ticket to `Nemo.app`, and publishes the final
`Nemo.zip`.

You can also package locally when the Developer ID certificate is already in
your login keychain:

```sh
APPLE_TEAM_ID=5P2L88KTNE \
APPLE_ID=you@example.com \
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx \
NEMO_VERSION=0.1.0 \
bun run package:macos
```

For an unsigned local smoke package:

```sh
NEMO_SKIP_NOTARIZATION=1 bun run package:macos
```

Unsigned packages are only for local verification. Do not publish them as cask
assets.

## Tag A Release

Update the release version in source first, then push a `v*` tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```

The release workflow runs `bun test`, builds both Linux agent binaries, packages
the macOS app, writes checksums, and creates or updates the matching GitHub
release.

Manual workflow dispatch also accepts a version input and creates a release for
`v<version>` from the current commit.

## Homebrew Cask

The cask uses `version :latest` and `sha256 :no_check` so it can stay static
while releases are still young:

```sh
brew tap omarestrella/nemo https://github.com/omarestrella/nemo
brew install --cask omarestrella/nemo/nemo
```

Once releases stabilize, replace the cask with pinned `version` and `sha256`
values per release.

## Agent Installer

The installer is intentionally static and curlable:

```sh
curl -fsSL https://omarestrella.github.io/nemo/install.sh | sh
```

It supports these environment variables:

- `NEMO_REPO`: GitHub repo to download from. Defaults to `omarestrella/nemo`.
- `NEMO_VERSION`: release tag. Defaults to `latest`.
- `NEMO_PREFIX`: install prefix. Defaults to `/usr/local`.
- `NEMO_STATE_DIR`: state directory. Defaults to `/var/lib/nemo-agent`.
- `NEMO_HOST`: service listener host. Defaults to `0.0.0.0`.
- `NEMO_PORT`: service listener port. Defaults to `7331`.
- `NEMO_INSTALL_ONLY=1`: install only `/usr/local/bin/nemo-agent`.
