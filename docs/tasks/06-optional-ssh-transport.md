# Optional SSH Transport

Delete this file when this slice is complete, or delete it if this transport is
deferred indefinitely.

## Goal

Add direct SSH as an advanced transport without making it the primary product
path.

## Constraints

- Do not require SSH for the normal sidecar flow.
- Do not assume Tailscale, SSH agent, 1Password, or a specific user.
- Do not store private keys.
- Do not run arbitrary commands.

## Work

- Add an advanced SSH profile type.
- Invoke commands through the local `ssh` binary with:

```sh
ssh \
  -o BatchMode=yes \
  -o ConnectTimeout=8 \
  -o NumberOfPasswordPrompts=0 \
  dokku@dokku.example.com \
  apps:list
```

- Reuse the same typed client models.
- Reuse the same read-only command allowlist.
- Surface auth failures clearly.
- Show the exact terminal command users can run to debug failures.

## Done When

- SSH is explicitly advanced/optional.
- SSH failures cannot hang the menu app on prompts.
- The UI stays transport-agnostic above the client layer.
