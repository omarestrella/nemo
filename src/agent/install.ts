import { chmod, chown, mkdir, rm, stat } from "node:fs/promises";

import { AGENT_VERSION } from "./types";
export const DEFAULT_CONFIG_DIR = "/etc/nemo-agent";
export const INSTALLED_BINARY_PATH = "/usr/local/bin/nemo-agent";
export const SERVICE_USER = "nemo-agent";
export const SERVICE_GROUP = "nemo-agent";
export const HELPER_DIR = "/usr/local/lib/nemo-agent";
export const DOKKU_READONLY_HELPER_PATH = `${HELPER_DIR}/dokku-readonly`;
export const SUDOERS_PATH = "/etc/sudoers.d/nemo-agent";
export const SYSTEMD_UNIT_PATH = "/etc/systemd/system/nemo-agent.service";
export const AVAHI_SERVICE_PATH = "/etc/avahi/services/nemo-agent.service";

export interface InstallPaths {
  configDir: string;
  stateDir: string;
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
    host: options.host ?? "0.0.0.0",
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

  const root = { uid: 0, gid: 0 };
  await ensureServiceAccount(result);
  const service = await serviceOwner();
  await ensureDirectory(paths.configDir, 0o750, root, result);
  await ensureDirectory(paths.stateDir, 0o700, service, result);
  await ensureDirectory(HELPER_DIR, 0o755, root, result);
  await installFile(DOKKU_READONLY_HELPER_PATH, renderDokkuReadonlyHelper(), 0o755, root, result);
  await installFile(SUDOERS_PATH, renderSudoers(), 0o440, root, result);
  await installFile(SYSTEMD_UNIT_PATH, renderSystemdUnit(paths), 0o644, root, result);
  await installAvahiService(paths, root, result);

  return result;
}

export async function ensureAgentStateOwnership(paths: { stateDir: string; databasePath: string; secretPath: string }): Promise<void> {
  if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() !== 0) {
    return;
  }
  const owner = await serviceOwner();
  for (const path of [paths.stateDir, paths.databasePath, paths.secretPath, `${paths.databasePath}-shm`, `${paths.databasePath}-wal`]) {
    if (await Bun.file(path).exists()) {
      await chown(path, owner.uid, owner.gid);
    }
  }
}

export function renderSystemdUnit(paths: InstallPaths): string {
  return `[Unit]
Description=Nemo agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
ExecStart=${INSTALLED_BINARY_PATH} serve --state-dir ${paths.stateDir} --host ${paths.host} --port ${paths.port} --dokku-helper ${DOKKU_READONLY_HELPER_PATH}
Restart=on-failure
RestartSec=2
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=${paths.stateDir}
LockPersonality=true
MemoryDenyWriteExecute=true
RestrictRealtime=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
`;
}

export function renderAvahiService(paths: InstallPaths): string {
  return `<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">Nemo on %h</name>
  <service>
    <type>_nemo-agent._tcp</type>
    <port>${paths.port}</port>
    <txt-record>apiVersion=1</txt-record>
    <txt-record>path=/</txt-record>
  </service>
</service-group>
`;
}

export function renderDokkuReadonlyHelper(): string {
  return `#!/bin/sh
set -eu

app_pattern='^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'

is_app() {
  printf '%s\\n' "$1" | grep -Eq "$app_pattern"
}

is_limit() {
  case "$1" in
    ''|*[!0-9]*)
      return 1
      ;;
  esac
  [ "$1" -ge 1 ] && [ "$1" -le 500 ]
}

allowed=0
case "$#" in
  1)
    if [ "$1" = "version" ] || [ "$1" = "events" ]; then
      allowed=1
    fi
    ;;
  2)
    if [ "$1" = "--quiet" ] && [ "$2" = "apps:list" ]; then
      allowed=1
    elif [ "$1" = "urls" ] && is_app "$2"; then
      allowed=1
    elif [ "$1" = "letsencrypt:active" ] && is_app "$2"; then
      allowed=1
    fi
    ;;
  3)
    if [ "$1" = "ps:report" ] && is_app "$2" && { [ "$3" = "--running" ] || [ "$3" = "--deployed" ] || [ "$3" = "--status" ]; }; then
      allowed=1
    elif [ "$1" = "ports:report" ] && is_app "$2" && [ "$3" = "--ports-map" ]; then
      allowed=1
    elif [ "$1" = "domains:report" ] && is_app "$2" && [ "$3" = "--domains-app-vhosts" ]; then
      allowed=1
    fi
    ;;
  4)
    if [ "$1" = "logs" ] && is_app "$2" && [ "$3" = "--num" ] && is_limit "$4"; then
      allowed=1
    fi
    ;;
esac

if [ "$allowed" -ne 1 ]; then
  echo "nemo-agent: Dokku command is not allowlisted" >&2
  exit 64
fi

if command -v dokku >/dev/null 2>&1; then
  exec dokku "$@"
fi

if [ -x /usr/bin/dokku ]; then
  exec /usr/bin/dokku "$@"
fi

if [ -x /usr/local/bin/dokku ]; then
  exec /usr/local/bin/dokku "$@"
fi

echo "nemo-agent: dokku binary not found" >&2
exit 127
`;
}

export function renderSudoers(): string {
  return `Defaults:${SERVICE_USER} !requiretty
${SERVICE_USER} ALL=(root) NOPASSWD: ${DOKKU_READONLY_HELPER_PATH} *
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

async function removeLegacyFile(path: string, result: InstallResult): Promise<void> {
  if (await Bun.file(path).exists()) {
    await rm(path, { force: true });
    result.changed.push(`removed legacy ${path}`);
  }
}

async function installAvahiService(paths: InstallPaths, owner: Owner, result: InstallResult): Promise<void> {
  if (isLoopbackHost(paths.host)) {
    await removeLegacyFile(AVAHI_SERVICE_PATH, result);
    return;
  }
  const avahiServiceDir = "/etc/avahi/services";
  const info = await statPath(avahiServiceDir);
  if (!info?.isDirectory()) {
    result.printed.push(`Skipped Bonjour advertisement because ${avahiServiceDir} does not exist.`);
    return;
  }
  await installFile(AVAHI_SERVICE_PATH, renderAvahiService(paths), 0o644, owner, result);
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
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

async function ensureServiceAccount(result: InstallResult): Promise<void> {
  if (!(await groupExists(SERVICE_GROUP))) {
    await runInstallCommand(["groupadd", "--system", SERVICE_GROUP]);
    result.changed.push(`created group ${SERVICE_GROUP}`);
  }
  if (!(await userExists(SERVICE_USER))) {
    await runInstallCommand([
      "useradd",
      "--system",
      "--gid",
      SERVICE_GROUP,
      "--home-dir",
      "/nonexistent",
      "--shell",
      "/usr/sbin/nologin",
      "--no-create-home",
      SERVICE_USER,
    ]);
    result.changed.push(`created user ${SERVICE_USER}`);
  }
}

async function userExists(user: string): Promise<boolean> {
  return (await run(["id", "-u", user])).exitCode === 0;
}

async function groupExists(group: string): Promise<boolean> {
  return (await run(["getent", "group", group])).exitCode === 0;
}

async function serviceOwner(): Promise<Owner> {
  const uid = await idValue(["id", "-u", SERVICE_USER]);
  const gid = await idValue(["getent", "group", SERVICE_GROUP], (value) => value.split(":")[2]);
  return { uid, gid };
}

async function idValue(args: string[], select: (value: string) => string | undefined = (value) => value): Promise<number> {
  const result = await run(args);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `${args.join(" ")} failed`);
  }
  const raw = select(result.stdout.trim());
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`Could not resolve numeric id from ${args.join(" ")}`);
  }
  return value;
}

async function runInstallCommand(args: string[]): Promise<void> {
  const result = await run(args);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `${args.join(" ")} failed`);
  }
}

async function run(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const process = Bun.spawn(args, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    return { exitCode, stdout, stderr };
  } catch (error) {
    return {
      exitCode: 127,
      stdout: "",
      stderr: error instanceof Error ? error.message : "command failed",
    };
  }
}

function renderInstallScript(paths: InstallPaths): string {
  return `Run as root on the Dokku host to install host integration:

getent group ${SERVICE_GROUP} >/dev/null || groupadd --system ${SERVICE_GROUP}
id -u ${SERVICE_USER} >/dev/null 2>&1 || useradd --system --gid ${SERVICE_GROUP} --home-dir /nonexistent --shell /usr/sbin/nologin --no-create-home ${SERVICE_USER}
install -d -m 0750 ${paths.configDir}
install -d -m 0700 ${paths.stateDir}
install -d -m 0755 ${HELPER_DIR}
chown root:root ${paths.configDir} ${HELPER_DIR}
chown ${SERVICE_USER}:${SERVICE_GROUP} ${paths.stateDir}

# ${DOKKU_READONLY_HELPER_PATH}
${renderDokkuReadonlyHelper()}

# ${SUDOERS_PATH}
${renderSudoers()}

# ${SYSTEMD_UNIT_PATH}
${renderSystemdUnit(paths)}

${isLoopbackHost(paths.host) ? "# Bonjour advertisement skipped for loopback-only listener." : `# ${AVAHI_SERVICE_PATH}
${renderAvahiService(paths)}`}

nemo-agent ${AGENT_VERSION}
`;
}
