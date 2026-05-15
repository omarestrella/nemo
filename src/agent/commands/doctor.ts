import { existsSync } from "node:fs";

import { BunDokkuCommandRunner, DokkuAdapter } from "../dokku";
import { AgentState, ensureStateLayout, inspectPathMode, resolveStatePaths } from "../storage";
import { flagBool, flagString, stateDir, type ParsedArgs } from "./args";

export async function doctorCommand(parsed: ParsedArgs): Promise<void> {
  const fix = flagBool(parsed, "fix");
  const paths = resolveStatePaths({ stateDir: stateDir(parsed) });

  if (fix) {
    await ensureStateLayout(paths);
    const state = await AgentState.open({ stateDir: paths.stateDir });
    state.close();
  }

  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  checks.push({
    name: "state directory",
    ok: existsSync(paths.stateDir) && inspectPathMode(paths.stateDir) === 0o700,
    detail: existsSync(paths.stateDir) ? modeDetail(paths.stateDir) : "missing",
  });
  checks.push({
    name: "server secret",
    ok: existsSync(paths.secretPath) && inspectPathMode(paths.secretPath) === 0o600,
    detail: existsSync(paths.secretPath) ? modeDetail(paths.secretPath) : "missing",
  });
  checks.push({
    name: "database",
    ok: existsSync(paths.databasePath),
    detail: existsSync(paths.databasePath) ? modeDetail(paths.databasePath) : "missing",
  });

  const dokkuBinary = flagString(parsed, "dokku-bin") ?? "dokku";
  const dokkuCheck = await checkDokku(dokkuBinary);
  checks.push(dokkuCheck);

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }

  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
  }
}

async function checkDokku(binary: string): Promise<{ name: string; ok: boolean; detail: string }> {
  const runner = new BunDokkuCommandRunner({ binary, timeoutMs: 3_000 });
  const dokku = new DokkuAdapter(runner);
  try {
    const version = await dokku.version();
    return { name: "dokku binary", ok: true, detail: version.raw || version.version || binary };
  } catch (error) {
    return {
      name: "dokku binary",
      ok: false,
      detail: error instanceof Error ? error.message : "unavailable",
    };
  }
}

function modeDetail(path: string): string {
  const mode = inspectPathMode(path);
  return mode === null ? "missing" : `mode ${mode.toString(8)}`;
}
