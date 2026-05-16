# Exposure And Packaging

Nemo's agent listens on `0.0.0.0:7331` by default so trusted LAN clients can discover it with Bonjour. Every endpoint beyond `/v1/health` requires a paired bearer credential.

Transport reachability and Nemo authentication are separate layers:

- The transport makes the agent endpoint reachable from the Mac.
- Nemo bearer auth decides whether a reachable request may read status data.

Do not bind the agent directly to a public internet interface. For untrusted networks, expose a narrow route through a reverse proxy, Tailscale Serve, or a user-managed SSH tunnel.

## Install The Agent

Build a Linux binary from the repo:

```sh
bun run build:linux-x64
# or
bun run build:linux-arm64
```

Copy the matching binary to the Dokku host as `/usr/local/bin/nemo-agent`, then
initialize the host integration:

```sh
sudo install -m 0755 nemo-agent-linux-x64 /usr/local/bin/nemo-agent
sudo nemo-agent init
sudo systemctl daemon-reload
sudo systemctl enable --now nemo-agent
sudo nemo-agent doctor --state-dir /var/lib/nemo-agent
```

`nemo-agent init` creates a restrictive state directory, a dedicated
`nemo-agent` service user, a root-owned Dokku read helper, a narrow sudoers
policy for that helper, and a systemd unit that binds the service to
`0.0.0.0:7331`. The long-running HTTP agent runs as `nemo-agent`, not root.
Dokku command execution goes through the helper and is limited to the read-only
commands needed by the API.

Root is required to install or repair those host artifacts, but it is not the
agent runtime identity. If you run `init` without root privileges, it prints the
shell commands needed to install the artifacts.

`doctor` prints a compact progress display and summarizes only warnings or
failures by default. Use `--verbose` when you want the full pass/warn/fail list.

## Pair A Client

Start a short-lived pairing session on the Dokku host. Use the endpoint URL that
the Mac will use after you set up the transport:

```sh
nemo-agent pair start \
  --name "Laptop" \
  --endpoint https://dokku.example.com/_nemo
```

Enter the pairing ID and Nemo pairing code in the macOS app. The code is
single-use and expires quickly. After pairing, the app stores the returned
credential in macOS Keychain.

## Localhost Only

For host-local-only checks, override the listener:

```sh
nemo-agent serve --state-dir /var/lib/nemo-agent --host 127.0.0.1 --port 7331
```

From the Dokku host:

```sh
curl http://127.0.0.1:7331/v1/health
```

This shape is not reachable from your Mac unless the Mac is the same machine or
you add a forwarding transport such as SSH.

## Local Raspberry Pi Smoke Test

For local project testing, `rpi.local` is the arm64 Dokku host reachable as
`omarestrella@rpi.local`. Skip the 1Password SSH agent when connecting from the
development Mac:

```sh
bun run build:linux-arm64
scp -o IdentityAgent=none dist/nemo-agent-linux-arm64 omarestrella@rpi.local:/tmp/nemo-agent
ssh -o IdentityAgent=none omarestrella@rpi.local
```

On the Pi:

```sh
sudo install -m 0755 /tmp/nemo-agent /usr/local/bin/nemo-agent
sudo nemo-agent init
sudo systemctl daemon-reload
sudo systemctl restart nemo-agent
curl http://127.0.0.1:7331/v1/health
curl http://rpi.local:7331/v1/health
sudo nemo-agent doctor --state-dir /var/lib/nemo-agent
```

The installed unit should not pin a Dokku binary path:

```sh
systemctl cat nemo-agent | grep ExecStart
```

For an authenticated smoke, create a pairing session and exchange it locally
against `http://127.0.0.1:7331`, then call `/v1/meta`, `/v1/apps`, an app detail
endpoint, logs, and events with the returned bearer credential.

## HTTPS Reverse Proxy

For untrusted remote exposure, use HTTPS. Trusted LAN and loopback HTTP are
supported for local discovery and pairing.

The examples below expose the agent under `/_nemo` and strip that prefix before
forwarding to the localhost listener. The agent still receives `/v1/...` paths.

### Caddy

```caddyfile
dokku.example.com {
  handle_path /_nemo/* {
    reverse_proxy 127.0.0.1:7331
  }
}
```

Health check:

```sh
curl https://dokku.example.com/_nemo/v1/health
```

### nginx

```nginx
location /_nemo/ {
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_pass http://127.0.0.1:7331/;
}
```

The trailing slash on `proxy_pass` is intentional. It strips `/_nemo/` so the
agent receives `/v1/health`, not `/_nemo/v1/health`.

## Tailscale Serve

Tailscale Serve can provide the same narrow reverse proxy without opening the
agent directly to the public internet:

```sh
tailscale serve --bg --set-path /_nemo http://127.0.0.1:7331
```

Use the HTTPS tailnet URL as the pairing endpoint:

```sh
nemo-agent pair start \
  --name "Laptop" \
  --endpoint https://dokku-host.tailnet-name.ts.net/_nemo
```

Tailscale is optional. Nemo does not require a tailnet, local SSH agent, or
1Password.

## SSH Tunnel

If you prefer not to configure a reverse proxy, forward the localhost listener
yourself:

```sh
ssh -N -L 7331:127.0.0.1:7331 dokku.example.com
```

Then pair and connect the Mac to:

```text
http://127.0.0.1:7331
```

Keep the tunnel under your own launchd, shell, or SSH configuration. Nemo does
not store SSH private keys.

## Packaging Direction

The first installer shape is the shell-script output produced by
`nemo-agent init` when it cannot install directly. That keeps the host changes
auditable while the read-only workflow is still stabilizing.

After the macOS client is usable, the likely next packaging step is:

- Debian package for Linux host artifacts and systemd integration.
- Homebrew formula or tap for installing the macOS app and CLI helpers.

The project should avoid package formats that hide the systemd unit or state
layout from review.
