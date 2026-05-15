# Optional Write Actions

Delete this file when write actions are implemented, or delete it if they are
out of scope.

## Goal

Only after the read-only product is stable, consider narrowly-scoped write
actions.

## Candidate Actions

- Restart app.
- Rebuild app.
- Renew certificate.

## Requirements

- Disabled by default.
- Separate user preference toggle.
- Separate write-scoped credentials.
- Confirmation prompt per action.
- Per-command allowlist.
- Clear success/failure output.
- Read credentials must never automatically become write credentials.

## Done When

- Write actions are explicitly opt-in.
- Each action is covered by command-level and API-level tests.
- Users can revoke write credentials independently from read credentials.
