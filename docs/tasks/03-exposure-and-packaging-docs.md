# Exposure And Packaging Docs

Delete this file when this slice is complete.

## Goal

Document and test the supported ways users expose a localhost-only sidecar.

## Supported Shapes

- Localhost-only for host-local checks and development.
- Reverse proxy to a narrow HTTPS route such as `/_nemo`.
- Tailscale Serve as a reverse proxy to the localhost listener.
- User-managed SSH tunnel to `127.0.0.1:<agent-port>`.

## Work

- Document the localhost-only default.
- Document Caddy and nginx reverse proxy examples.
- Document Tailscale Serve as an optional transport.
- Document user-managed SSH tunnel mode.
- State that transport reachability is separate from Nemo bearer auth.
- Document HTTPS expectations for non-loopback endpoints.
- Add a reverse-proxy Docker integration if practical, mapping `/_nemo` to the
  localhost listener.
- Decide whether installer output should start as shell script, Debian package,
  Homebrew tap, or a combination.

## Done When

- A user can install the agent, pair a client, and expose it through one
  documented localhost-forwarding shape without guessing.
- Docs do not contain private dogfood hostnames, tailnet addresses, app names,
  remotes, DNS provider details, or credentials.
