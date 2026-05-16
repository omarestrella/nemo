import { SERVICE_GROUP, SERVICE_USER } from "../install";
import { run } from "./process";
import type { Check } from "./types";

export async function systemdChecks(
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
    hardening.User === SERVICE_USER &&
    hardening.Group === SERVICE_GROUP &&
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
