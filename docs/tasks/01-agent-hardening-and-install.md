# Agent Hardening And Install

Delete this file when this slice is complete.

## Goal

Make `nemo-agent init`, `doctor`, and `doctor --fix` suitable for a real Dokku
host instead of only local development and Docker tests.

## Current State

- `init` creates state directory, SQLite database, and server secret.
- `doctor --fix` repairs local state layout.
- Docker integration verifies state permissions and basic Dokku command access.
- The service currently runs Dokku commands directly through the configured
  binary.

## Work

- Create a dedicated `nemo-agent` system user and group where missing.
- Create `/etc/nemo-agent` and `/var/lib/nemo-agent` with restrictive
  ownership and permissions.
- Generate `/var/lib/nemo-agent/server-secret` if missing.
- Initialize or migrate `/var/lib/nemo-agent/nemo-agent.db`.
- Install or print a root-owned read-only Dokku command wrapper.
- Install or print a narrow sudoers rule for that wrapper.
- Install or print a systemd unit for `nemo-agent serve`.
- Refuse unsafe existing state instead of silently weakening permissions.
- Add doctor checks for:
  - Agent version, binary path, and compile target.
  - Effective user and group.
  - State directory, database, config, and secret permissions.
  - Systemd unit presence, enablement, hardening options, and service health.
  - Listener binding only to `127.0.0.1`.
  - Dokku binary discovery and Dokku version.
  - Access to each allowlisted read-only Dokku command through the same
    privilege path used by the service.
  - Pairing and credential database readability by the service user.

## Done When

- `sudo nemo-agent init` is idempotent on a fresh Linux host.
- `nemo-agent doctor` reports pass/warn/fail without changing state.
- `sudo nemo-agent doctor --fix` repairs only safe local state issues.
- Docker integration covers the wrapper/sudoers/systemd path where feasible.
- `bun test` passes.
