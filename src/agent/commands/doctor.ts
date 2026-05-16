import { stat } from "node:fs/promises";
import { arch, platform } from "node:os";

import { DokkuCommandRunner, DokkuAdapter, isAllowedDokkuArgs } from "../dokku";
import {
  AVAHI_SERVICE_PATH,
  INSTALLED_BINARY_PATH,
  SYSTEMD_UNIT_PATH,
  defaultInstallPaths,
  ensureAgentStateOwnership,
  ensureHostInstall,
  fileContains,
  renderAvahiService,
  renderSystemdUnit,
} from "../install";
import {
  AgentState,
  ensureStateLayout,
  inspectPathMode,
  resolveStatePaths,
} from "../storage";
import { AGENT_VERSION } from "../types";
import {
  flagBool,
  flagInt,
  flagString,
  stateDir,
  type ParsedArgs,
} from "./args";

type Status = "PASS" | "WARN" | "FAIL";

interface Check {
  name: string;
  status: Status;
  detail: string;
}

export async function doctorCommand(parsed: ParsedArgs): Promise<void> {
  const fix = flagBool(parsed, "fix");
  const paths = resolveStatePaths({ stateDir: stateDir(parsed) });
  const installPaths = defaultInstallPaths({
    stateDir: paths.stateDir,
    host: flagString(parsed, "host") ?? undefined,
    port: flagInt(parsed, "port") ?? undefined,
  });

  if (fix) {
    await ensureHostInstall(installPaths);
    await ensureStateLayout(paths, { repairUnsafe: true });
    const state = await AgentState.open({
      stateDir: paths.stateDir,
      repairUnsafeLayout: true,
    });
    state.close();
    await ensureAgentStateOwnership(paths);
  }

  const checks: Check[] = [];
  checks.push({ name: "agent version", status: "PASS", detail: AGENT_VERSION });
  checks.push(compileTargetCheck());
  checks.push(
    await pathCheck("binary path", INSTALLED_BINARY_PATH, 0o111, true),
  );
  checks.push(...(await userChecks()));
  checks.push(
    await modeOwnerCheck(
      "config directory",
      installPaths.configDir,
      0o750,
      "root",
      "root",
    ),
  );
  checks.push(
    await modeOwnerCheck(
      "state directory",
      paths.stateDir,
      0o700,
      "root",
      "root",
    ),
  );
  checks.push(
    await modeOwnerCheck(
      "server secret",
      paths.secretPath,
      0o600,
      "root",
      "root",
    ),
  );
  checks.push(
    await modeOwnerCheck(
      "database",
      paths.databasePath,
      0o600,
      "root",
      "root",
    ),
  );
  checks.push(
    await fileCheck(
      "systemd unit",
      SYSTEMD_UNIT_PATH,
      renderSystemdUnit(installPaths),
      0o644,
      "root",
      "root",
    ),
  );
  checks.push(...(await serviceDiscoveryChecks(installPaths.host, installPaths)));
  checks.push(...(await systemdChecks(installPaths.host, installPaths.port)));
  checks.push(await listenerCheck(installPaths.host, installPaths.port));

  const serviceCommand = ["dokku"];
  checks.push(await checkDokku(serviceCommand));
  checks.push(...(await readCommandChecks(serviceCommand)));
  checks.push(
    await serviceUserReadCheck(
      "pairing and credential database readability",
      paths.databasePath,
    ),
  );

  for (const check of checks) {
    console.log(`${check.status} ${check.name}: ${check.detail}`);
  }

  if (checks.some((check) => check.status === "FAIL")) {
    process.exitCode = 1;
  }
}

async function checkDokku(command: string[]): Promise<Check> {
  const runner = new DokkuCommandRunner({
    commandPrefix: command,
    timeoutMs: 3_000,
  });
  const dokku = new DokkuAdapter(runner);
  try {
    const version = await dokku.version();
    return {
      name: "dokku command path",
      status: "PASS",
      detail: version.raw || version.version || command.join(" "),
    };
  } catch (error) {
    return {
      name: "dokku command path",
      status: "FAIL",
      detail: error instanceof Error ? error.message : "unavailable",
    };
  }
}

async function readCommandChecks(commandPrefix: string[]): Promise<Check[]> {
  const appName = await discoverApp(commandPrefix);
  const commands = [["version"], ["--quiet", "apps:list"], ["events"]];
  if (appName) {
    commands.push(
      ["urls", appName],
      ["ps:report", appName, "--running"],
      ["ps:report", appName, "--deployed"],
      ["ps:report", appName, "--status"],
      ["ports:report", appName, "--ports-map"],
      ["domains:report", appName, "--domains-app-vhosts"],
      ["letsencrypt:active", appName],
      ["logs", appName, "--num", "100"],
    );
  }
  const checks: Check[] = [];
  if (!appName) {
    checks.push({
      name: "read command app-specific probes",
      status: "WARN",
      detail: "no Dokku apps found; skipped app-specific probes",
    });
  }
  for (const command of commands) {
    if (!isAllowedDokkuArgs(command)) {
      checks.push({
        name: `read command ${command.join(" ")}`,
        status: "FAIL",
        detail: "not internally allowlisted",
      });
      continue;
    }
    const result = await run([...commandPrefix, ...command], 5_000);
    const reachedDokku =
      result.exitCode === 0 ||
      !isCommandAccessDenied(result.stderr || result.stdout);
    checks.push({
      name: `read command ${command.join(" ")}`,
      status: reachedDokku ? "PASS" : "FAIL",
      detail:
        result.exitCode === 0
          ? "command executed"
          : `reached Dokku: ${firstLine(result.stderr || result.stdout || `exit ${result.exitCode}`)}`,
    });
  }
  return checks;
}

async function modeOwnerCheck(
  name: string,
  path: string,
  expectedMode: number,
  expectedUser: string,
  expectedGroup: string,
): Promise<Check> {
  if (!(await pathExists(path))) {
    return { name, status: "FAIL", detail: "missing" };
  }
  const mode = await inspectPathMode(path);
  const owner = await ownerDetail(path);
  const ownerOk = owner.user === expectedUser && owner.group === expectedGroup;
  return {
    name,
    status: mode === expectedMode && ownerOk ? "PASS" : "FAIL",
    detail: `mode ${mode?.toString(8)} expected ${expectedMode.toString(8)}; owner ${owner.user}:${owner.group} expected ${expectedUser}:${expectedGroup}`,
  };
}

async function pathCheck(
  name: string,
  path: string,
  executableBits: number,
  warnOnly: boolean,
): Promise<Check> {
  if (!(await pathExists(path))) {
    return { name, status: warnOnly ? "WARN" : "FAIL", detail: "missing" };
  }
  const mode = (await inspectPathMode(path)) ?? 0;
  return {
    name,
    status: (mode & executableBits) !== 0 ? "PASS" : warnOnly ? "WARN" : "FAIL",
    detail: `${path} mode ${mode.toString(8)}`,
  };
}

async function fileCheck(
  name: string,
  path: string,
  expectedContents: string,
  expectedMode: number,
  expectedUser: string,
  expectedGroup: string,
): Promise<Check> {
  if (!(await pathExists(path))) {
    return {
      name,
      status: "WARN",
      detail: "missing; run sudo nemo-agent doctor --fix",
    };
  }
  const mode = await inspectPathMode(path);
  const owner = await ownerDetail(path);
  const ownerOk = owner.user === expectedUser && owner.group === expectedGroup;
  const contentsOk = await fileContains(path, expectedContents);
  return {
    name,
    status: mode === expectedMode && ownerOk && contentsOk ? "PASS" : "WARN",
    detail: `mode ${mode?.toString(8)} expected ${expectedMode.toString(8)}; owner ${owner.user}:${owner.group} expected ${expectedUser}:${expectedGroup}; ${contentsOk ? "contents current" : "contents differ"}`,
  };
}

async function userChecks(): Promise<Check[]> {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const gid = typeof process.getgid === "function" ? process.getgid() : null;
  const user = Bun.env.USER ?? Bun.env.LOGNAME ?? "unknown";
  const group = (await run(["id", "-gn"])).stdout.trim() || "unknown";
  return [
    {
      name: "effective user",
      status: uid === 0 || user === "root" ? "PASS" : "WARN",
      detail: `${user}${uid === null ? "" : ` uid ${uid}`}`,
    },
    {
      name: "effective group",
      status: gid === 0 || group === "root" ? "PASS" : "WARN",
      detail: `${group}${gid === null ? "" : ` gid ${gid}`}`,
    },
  ];
}

async function systemdChecks(
  expectedHost: string,
  expectedPort: number,
): Promise<Check[]> {
  if (process.platform !== "linux") {
    return [
      { name: "systemd", status: "WARN", detail: "not running on Linux" },
    ];
  }
  const unit = await run(["systemctl", "is-enabled", "nemo-agent.service"]);
  const active = await run(["systemctl", "is-active", "nemo-agent.service"]);
  const show = await run([
    "systemctl",
    "show",
    "nemo-agent.service",
    "--property",
    "User,Group,ExecStart,PrivateTmp,ProtectSystem,ProtectHome,ReadWritePaths",
  ]);
  const hardening = parseSystemdShow(show.stdout);
  const hardeningOk =
    (hardening.User === "" || hardening.User === "root") &&
    (hardening.Group === "" || hardening.Group === "root") &&
    hardening.PrivateTmp === "yes" &&
    hardening.ProtectSystem === "strict" &&
    hardening.ProtectHome === "read-only" &&
    (hardening.ExecStart ?? "").includes(`--host ${expectedHost}`) &&
    (hardening.ExecStart ?? "").includes(`--port ${expectedPort}`);
  return [
    {
      name: "systemd enablement",
      status: unit.exitCode === 0 ? "PASS" : "WARN",
      detail: unit.stdout.trim() || unit.stderr.trim() || "not enabled",
    },
    {
      name: "systemd health",
      status: active.exitCode === 0 ? "PASS" : "WARN",
      detail: active.stdout.trim() || active.stderr.trim() || "not active",
    },
    {
      name: "systemd hardening",
      status: hardeningOk ? "PASS" : "WARN",
      detail:
        show.exitCode === 0
          ? "checked unit hardening and serve binding"
          : show.stderr.trim() || "systemctl show unavailable",
    },
  ];
}

async function serviceDiscoveryChecks(
  expectedHost: string,
  installPaths: ReturnType<typeof defaultInstallPaths>,
): Promise<Check[]> {
  if (process.platform !== "linux") {
    return [
      {
        name: "service discovery",
        status: "WARN",
        detail: "not running on Linux",
      },
    ];
  }
  if (isLoopbackHost(expectedHost)) {
    return [
      {
        name: "service discovery",
        status: "PASS",
        detail: "skipped for loopback-only listener",
      },
    ];
  }

  const serviceFile = await fileCheck(
    "service discovery file",
    AVAHI_SERVICE_PATH,
    renderAvahiService(installPaths),
    0o644,
    "root",
    "root",
  );
  const avahi = await run(["systemctl", "is-active", "avahi-daemon.service"]);
  const browse = await run(["avahi-browse", "-rt", "_nemo-agent._tcp"], 5_000);
  const browseOutput = `${browse.stdout}\n${browse.stderr}`;
  const browseFound =
    browse.exitCode === 0 &&
    browseOutput.includes("_nemo-agent._tcp") &&
    browseOutput.includes(String(installPaths.port));
  // avahi-browse lives in avahi-utils and is not always installed with the daemon.
  // The daemon journal still tells us whether Avahi loaded and established our service.
  const journal = browseFound
    ? null
    : await run([
        "journalctl",
        "-u",
        "avahi-daemon.service",
        "--no-pager",
        "-n",
        "80",
      ]);
  const journalOutput = `${journal?.stdout ?? ""}\n${journal?.stderr ?? ""}`;
  const journalFound =
    journal?.exitCode === 0 &&
    journalOutput.includes("nemo-agent.service") &&
    journalOutput.includes("successfully established");

  return [
    serviceFile,
    {
      name: "service discovery daemon",
      status: avahi.exitCode === 0 ? "PASS" : "WARN",
      detail:
        avahi.stdout.trim() ||
        avahi.stderr.trim() ||
        "avahi-daemon.service not active",
    },
    {
      name: "service discovery advertisement",
      status: browseFound || journalFound ? "PASS" : "WARN",
      detail: browseFound
        ? firstLine(browseOutput)
        : journalFound
          ? "avahi-daemon established nemo-agent.service"
        : firstLine(browseOutput) ||
          firstLine(journalOutput) ||
          "could not browse _nemo-agent._tcp; verify avahi-utils and mDNS networking",
    },
  ];
}

async function serviceUserReadCheck(
  name: string,
  path: string,
): Promise<Check> {
  if (!(await pathExists(path))) {
    return { name, status: "FAIL", detail: "missing" };
  }
  if (
    process.platform === "linux" &&
    (await Bun.file("/usr/bin/sudo").exists())
  ) {
    const result = await run([
      "/usr/bin/sudo",
      "-n",
      "-u",
      "root",
      "test",
      "-r",
      path,
    ]);
    return {
      name,
      status: result.exitCode === 0 ? "PASS" : "FAIL",
      detail:
        result.exitCode === 0
          ? "readable by root"
          : firstLine(result.stderr || result.stdout || "not readable"),
    };
  }
  try {
    await stat(path);
    return {
      name,
      status: "WARN",
      detail: "sudo unavailable; checked current user readability only",
    };
  } catch (error) {
    return {
      name,
      status: "FAIL",
      detail: error instanceof Error ? error.message : "not readable",
    };
  }
}

async function listenerCheck(
  expectedHost: string,
  expectedPort: number,
): Promise<Check> {
  if (process.platform !== "linux") {
    return {
      name: "listener binding",
      status: "WARN",
      detail: "not running on Linux",
    };
  }
  const ss = await run(["ss", "-ltn"]);
  if (ss.exitCode !== 0) {
    return {
      name: "listener binding",
      status: "WARN",
      detail: ss.stderr.trim() || "ss unavailable",
    };
  }
  const listeners = ss.stdout
    .split("\n")
    .filter((line) => line.includes(`:${expectedPort}`))
    .map((line) => line.trim());
  if (listeners.length === 0) {
    return {
      name: "listener binding",
      status: "WARN",
      detail: `no listener on port ${expectedPort}`,
    };
  }
  const unsafe = listeners.filter(
    (line) =>
      !line.includes(`${expectedHost}:${expectedPort}`) &&
      !line.includes(`[${expectedHost}]:${expectedPort}`),
  );
  return {
    name: "listener binding",
    status:
      unsafe.length === 0 || expectedHost === "0.0.0.0" ? "PASS" : "FAIL",
    detail:
      unsafe.length === 0
        ? listeners.join("; ")
        : `unsafe listener(s): ${unsafe.join("; ")}`,
  };
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function compileTargetCheck(): Check {
  const target = `${platform()}/${arch()}`;
  return {
    name: "compile target",
    status:
      platform() === "linux" && ["x64", "arm64"].includes(arch())
        ? "PASS"
        : "WARN",
    detail: target,
  };
}

async function run(
  args: string[],
  timeoutMs = 3_000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const process = Bun.spawn(args, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeout = setTimeout(() => process.kill("SIGKILL"), timeoutMs);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]).finally(() => clearTimeout(timeout));
    return { exitCode, stdout, stderr };
  } catch (error) {
    return {
      exitCode: 127,
      stdout: "",
      stderr: error instanceof Error ? error.message : "command failed",
    };
  }
}

async function discoverApp(commandPrefix: string[]): Promise<string | null> {
  const result = await run([...commandPrefix, "--quiet", "apps:list"], 5_000);
  if (result.exitCode !== 0) {
    return null;
  }
  return (
    result.stdout
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

async function ownerDetail(
  path: string,
): Promise<{ user: string; group: string }> {
  const info = await stat(path);
  const [user, group] = await Promise.all([
    nameForId("getent", "passwd", info.uid),
    nameForId("getent", "group", info.gid),
  ]);
  return { user: user ?? String(info.uid), group: group ?? String(info.gid) };
}

async function nameForId(
  command: string,
  database: "passwd" | "group",
  id: number,
): Promise<string | null> {
  const result = await run([command, database, String(id)]);
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout.split(":")[0] || null;
}

function parseSystemdShow(raw: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const index = line.indexOf("=");
    if (index > 0) {
      values[line.slice(0, index)] = line.slice(index + 1);
    }
  }
  return values;
}

function firstLine(value: string): string {
  return (
    value
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? value.trim()
  );
}

function isCommandAccessDenied(output: string): boolean {
  const normalized = output.toLowerCase();
  return (
    normalized.includes("a password is required") ||
    normalized.includes("not in the sudoers") ||
    normalized.includes("permission denied")
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}
