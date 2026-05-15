import { chmod, chown, mkdir, rm, stat } from "node:fs/promises";

import { AGENT_VERSION } from "./types";
export const DEFAULT_CONFIG_DIR = "/etc/nemo-agent";
export const INSTALLED_BINARY_PATH = "/usr/local/bin/nemo-agent";
export const SYSTEMD_UNIT_PATH = "/etc/systemd/system/nemo-agent.service";

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

  const root = { uid: 0, gid: 0 };
  await ensureDirectory(paths.configDir, 0o750, root, result);
  await ensureDirectory(paths.stateDir, 0o700, root, result);
  await installFile(SYSTEMD_UNIT_PATH, renderSystemdUnit(paths), 0o644, root, result);
  await removeLegacyFile("/etc/sudoers.d/nemo-agent", result);
  await removeLegacyFile("/usr/local/lib/nemo-agent/dokku-readonly", result);

  return result;
}

export async function ensureAgentStateOwnership(paths: { stateDir: string; databasePath: string; secretPath: string }): Promise<void> {
  if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() !== 0) {
    return;
  }
  for (const path of [paths.stateDir, paths.databasePath, paths.secretPath]) {
    if (await Bun.file(path).exists()) {
      await chown(path, 0, 0);
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
ExecStart=${INSTALLED_BINARY_PATH} serve --state-dir ${paths.stateDir} --host ${paths.host} --port ${paths.port}
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

function renderInstallScript(paths: InstallPaths): string {
  return `Run as root on the Dokku host to install host integration:

install -d -m 0750 ${paths.configDir}
install -d -m 0700 ${paths.stateDir}
chown root:root ${paths.configDir} ${paths.stateDir}

# ${SYSTEMD_UNIT_PATH}
${renderSystemdUnit(paths)}

nemo-agent ${AGENT_VERSION}
`;
}
