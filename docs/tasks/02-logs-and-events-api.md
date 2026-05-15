# Logs And Events API

Delete this file when this slice is complete.

## Goal

Complete the read-only sidecar API needed for app detail views: recent logs and
platform events.

## Current State

Implemented:

- `GET /v1/health`
- `POST /v1/pairing/exchange`
- `GET /v1/meta`
- `GET /v1/platform/version`
- `GET /v1/apps`
- `GET /v1/apps/:app`

Missing:

- `GET /v1/apps/:app/logs?lines=200`
- `GET /v1/events?limit=50`

## Work

- Add typed `LogLine` and `PlatformEvent` models.
- Add allowlisted execution for:
  - `logs <app> --num <bounded-lines>`
  - `events`
- Bound `lines` and `limit` query params.
- Validate app names against existing app list or the conservative app-name
  pattern before invoking Dokku.
- Treat missing `events` support as a structured, retryable platform status
  rather than a crash.
- Preserve raw text where parsing is ambiguous.
- Add fast tests for parameter validation and auth failures.
- Extend Docker integration to call logs/events where the Dokku container can
  support it reliably.

## Done When

- Authenticated clients can fetch app logs and events.
- All new command paths remain allowlisted and argument-array based.
- Failures return structured JSON errors.
- `bun test` passes.
