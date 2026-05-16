import { DokkuAdapter, DokkuCommandRunner, isAllowedDokkuArgs } from "../dokku";
import { DOKKU_READONLY_HELPER_PATH, SERVICE_USER } from "../install";
import { firstLine, isCommandAccessDenied, run } from "./process";
import type { Check } from "./types";

export async function checkDokku(command: string[]): Promise<Check> {
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

export async function serviceDokkuCommandPrefix(): Promise<string[]> {
  if (
    process.platform === "linux" &&
    typeof process.getuid === "function" &&
    process.getuid() === 0 &&
    (await Bun.file("/usr/bin/sudo").exists())
  ) {
    return [
      "/usr/bin/sudo",
      "-n",
      "-u",
      SERVICE_USER,
      "/usr/bin/sudo",
      "-n",
      DOKKU_READONLY_HELPER_PATH,
    ];
  }
  return ["sudo", "-n", DOKKU_READONLY_HELPER_PATH];
}

export async function serviceDokkuSudoCheck(): Promise<Check> {
  if (process.platform !== "linux") {
    return {
      name: "service Dokku sudo policy",
      status: "WARN",
      detail: "not running on Linux",
    };
  }
  if (!(await Bun.file("/usr/bin/sudo").exists())) {
    return {
      name: "service Dokku sudo policy",
      status: "FAIL",
      detail: "sudo unavailable",
    };
  }
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    const result = await run([
      "/usr/bin/sudo",
      "-n",
      "-u",
      SERVICE_USER,
      "/usr/bin/sudo",
      "-n",
      DOKKU_READONLY_HELPER_PATH,
      "version",
    ]);
    return {
      name: "service Dokku sudo policy",
      status: result.exitCode === 0 ? "PASS" : "FAIL",
      detail:
        result.exitCode === 0
          ? "service user can run read helper without a password"
          : firstLine(result.stderr || result.stdout || "sudo policy failed"),
    };
  }
  const result = await run(["sudo", "-n", DOKKU_READONLY_HELPER_PATH, "version"]);
  return {
    name: "service Dokku sudo policy",
    status: result.exitCode === 0 ? "PASS" : "WARN",
    detail:
      result.exitCode === 0
        ? "current user can run read helper without a password"
        : firstLine(
            result.stderr ||
              result.stdout ||
              "run doctor as root to verify service user sudo policy",
          ),
  };
}

export async function readCommandChecks(commandPrefix: string[]): Promise<Check[]> {
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
