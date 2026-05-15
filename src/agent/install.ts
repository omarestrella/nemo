import { chmod, chown, mkdir, stat } from "node:fs/promises";

import { AGENT_VERSION } from "./types";

export const AGENT_USER = "nemo-agent";
export const AGENT_GROUP = "nemo-agent";
export const DEFAULT_CONFIG_DIR = "/etc/nemo-agent";
export const DOKKU_WRAPPER_PATH = "/usr/local/lib/nemo-agent/dokku-readonly";
export const INSTALLED_BINARY_PATH = "/usr/local/bin/nemo-agent";
export const SUDOERS_PATH = "/etc/sudoers.d/nemo-agent";
export const SYSTEMD_UNIT_PATH = "/etc/systemd/system/nemo-agent.service";

export interface InstallPaths {
  configDir: string;
  stateDir: string;
  dokkuBin: string;
  host: string;
  port: number;
}

export interface InstallResult {
  changed: string[];
  printed: string[];
}

interface Owner {
  uid: number;
  gid: number;
}

export function defaultInstallPaths(options: Partial<InstallPaths> & { stateDir: string }): InstallPaths {
  return {
    configDir: options.configDir ?? DEFAULT_CONFIG_DIR,
    stateDir: options.stateDir,
    dokkuBin: options.dokkuBin ?? "/usr/bin/dokku",
    host: options.host ?? "127.0.0.1",
    port: options.port ?? 7331,
  };
}

export async function ensureHostInstall(paths: InstallPaths): Promise<InstallResult> {
  const result: InstallResult = { changed: [], printed: [] };
  const canInstall = process.platform === "linux" && typeof process.getuid === "function" && process.getuid() === 0;

  if (!canInstall) {
    result.printed.push(renderInstallScript(paths));
    return result;
  }

  await ensureGroup(AGENT_GROUP, result);
  await ensureUser(AGENT_USER, AGENT_GROUP, paths.stateDir, result);
  const root = { uid: 0, gid: 0 };
  const agent = await resolveOwner(AGENT_USER, AGENT_GROUP);
  await ensureDirectory(paths.configDir, 0o750, root, result);
  await ensureDirectory(paths.stateDir, 0o700, agent, result);
  await ensureDirectory("/usr/local/lib/nemo-agent", 0o755, root, result);
  await installFile(DOKKU_WRAPPER_PATH, renderDokkuWrapper(paths.dokkuBin), 0o755, root, result);
  await installFile(SUDOERS_PATH, renderSudoers(), 0o440, root, result);
  await installFile(SYSTEMD_UNIT_PATH, renderSystemdUnit(paths), 0o644, root, result);

  return result;
}

export async function ensureAgentStateOwnership(paths: { stateDir: string; databasePath: string; secretPath: string }): Promise<void> {
  if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() !== 0) {
    return;
  }
  const agent = await resolveOwner(AGENT_USER, AGENT_GROUP);
  for (const path of [paths.stateDir, paths.databasePath, paths.secretPath]) {
    if (await Bun.file(path).exists()) {
      await chown(path, agent.uid, agent.gid);
    }
  }
}

export function renderDokkuWrapper(dokkuBin: string): string {
  return `#!/bin/sh
set -eu

DOKKU_BIN="${dokkuBin}"

is_app_name() {
  case "$1" in
    ""|-*|*[!a-z0-9-]*|*-)
      return 1
      ;;
  esac
  return 0
}

if [ "$#" -eq 1 ] && [ "$1" = "version" ]; then
  exec "$DOKKU_BIN" "$@"
fi

if [ "$#" -eq 2 ] && [ "$1" = "--quiet" ] && [ "$2" = "apps:list" ]; then
  exec "$DOKKU_BIN" "$@"
fi

if [ "$#" -eq 1 ] && [ "$1" = "events" ]; then
  exec "$DOKKU_BIN" "$@"
fi

if [ "$#" -eq 2 ] && [ "$1" = "urls" ] && is_app_name "$2"; then
  exec "$DOKKU_BIN" "$@"
fi

if [ "$#" -eq 3 ] && is_app_name "$2"; then
  case "$1 $3" in
    "ps:report --running"|"ps:report --deployed"|"ps:report --status"|"ports:report --ports-map"|"domains:report --domains-app-vhosts")
      exec "$DOKKU_BIN" "$@"
      ;;
  esac
fi

if [ "$#" -eq 2 ] && [ "$1" = "letsencrypt:active" ] && is_app_name "$2"; then
  exec "$DOKKU_BIN" "$@"
fi

if [ "$#" -eq 4 ] && [ "$1" = "logs" ] && is_app_name "$2" && [ "$3" = "--num" ]; then
  case "$4" in
    *[!0-9]*|"")
      ;;
    *)
      if [ "$4" -ge 1 ] && [ "$4" -le 500 ]; then
        exec "$DOKKU_BIN" "$@"
      fi
      ;;
  esac
fi

echo "nemo-agent: Dokku command is not allowlisted" >&2
exit 126
`;
}

export function renderSudoers(): string {
return `${AGENT_USER} ALL=(dokku) NOPASSWD: ${DOKKU_WRAPPER_PATH} *
Defaults!${DOKKU_WRAPPER_PATH} !requiretty
`;
}

export function renderSystemdUnit(paths: InstallPaths): string {
  return `[Unit]
Description=Nemo agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${AGENT_USER}
Group=${AGENT_GROUP}
ExecStart=${INSTALLED_BINARY_PATH} serve --state-dir ${paths.stateDir} --host ${paths.host} --port ${paths.port} --dokku-bin ${DOKKU_WRAPPER_PATH}
Restart=on-failure
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${paths.stateDir}
CapabilityBoundingSet=
LockPersonality=true
MemoryDenyWriteExecute=true
RestrictRealtime=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
`;
}

export async function fileContains(path: string, text: string): Promise<boolean> {
  return (await Bun.file(path).exists()) && (await Bun.file(path).text()) === text;
}

async function ensureDirectory(path: string, mode: number, owner: Owner, result: InstallResult): Promise<void> {
  let info = await statPath(path);
  if (!info) {
    await mkdir(path, { recursive: true, mode });
    result.changed.push(`created ${path}`);
    info = await stat(path);
  }
  if (!info.isDirectory()) {
    throw new Error(`${path} exists but is not a directory`);
  }
  await ensureModeOwner(path, mode, owner, result);
}

async function installFile(path: string, contents: string, mode: number, owner: Owner, result: InstallResult): Promise<void> {
  if (!(await fileContains(path, contents))) {
    await Bun.write(path, contents);
    await chmod(path, mode);
    result.changed.push(`installed ${path}`);
  }
  await ensureModeOwner(path, mode, owner, result);
}

async function ensureModeOwner(path: string, mode: number, owner: Owner, result: InstallResult): Promise<void> {
  const info = await stat(path);
  const actualMode = info.mode & 0o777;
  if (actualMode !== mode) {
    await chmod(path, mode);
    result.changed.push(`set mode ${mode.toString(8)} on ${path}`);
  }
  if (info.uid !== owner.uid || info.gid !== owner.gid) {
    await chown(path, owner.uid, owner.gid);
    result.changed.push(`set owner ${owner.uid}:${owner.gid} on ${path}`);
  }
}

async function ensureGroup(group: string, result: InstallResult): Promise<void> {
  if ((await run(["getent", "group", group])).exitCode === 0) {
    return;
  }
  await runRequired(["groupadd", "--system", group]);
  result.changed.push(`created group ${group}`);
}

async function ensureUser(user: string, group: string, home: string, result: InstallResult): Promise<void> {
  if ((await run(["id", "-u", user])).exitCode === 0) {
    return;
  }
  await runRequired(["useradd", "--system", "--gid", group, "--home-dir", home, "--shell", "/usr/sbin/nologin", user]);
  result.changed.push(`created user ${user}`);
}

async function resolveOwner(user: string, group: string): Promise<Owner> {
  const uid = (await run(["id", "-u", user])).stdout.trim();
  const gid = (await run(["getent", "group", group])).stdout.split(":")[2]?.trim();
  if (!uid || !gid) {
    throw new Error(`Could not resolve owner ${user}:${group}`);
  }
  return { uid: Number.parseInt(uid, 10), gid: Number.parseInt(gid, 10) };
}

async function runRequired(args: string[]): Promise<void> {
  const result = await run(args);
  if (result.exitCode !== 0) {
    throw new Error(`${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

async function run(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const process = Bun.spawn(args, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function statPath(path: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function renderInstallScript(paths: InstallPaths): string {
  return `Run as root on the Dokku host to install host integration:

groupadd --system ${AGENT_GROUP} || true
id -u ${AGENT_USER} >/dev/null 2>&1 || useradd --system --gid ${AGENT_GROUP} --home-dir ${paths.stateDir} --shell /usr/sbin/nologin ${AGENT_USER}
install -d -m 0750 ${paths.configDir}
install -d -m 0700 ${paths.stateDir}
install -d -m 0755 /usr/local/lib/nemo-agent
chown root:root ${paths.configDir} /usr/local/lib/nemo-agent
chown ${AGENT_USER}:${AGENT_GROUP} ${paths.stateDir}

# ${DOKKU_WRAPPER_PATH}
${renderDokkuWrapper(paths.dokkuBin)}

# ${SUDOERS_PATH}
${renderSudoers()}

# ${SYSTEMD_UNIT_PATH}
${renderSystemdUnit(paths)}

nemo-agent ${AGENT_VERSION}
`;
}
