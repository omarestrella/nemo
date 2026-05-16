import { stat } from "node:fs/promises";

import { SERVICE_USER, fileContains } from "../install";
import { inspectPathMode } from "../storage";
import { firstLine, run } from "./process";
import type { Check } from "./types";

export async function modeOwnerCheck(
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

export async function pathCheck(
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

export async function fileCheck(
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

export async function accountCheck(
  name: string,
  value: string,
  kind: "user" | "group",
): Promise<Check> {
  const result =
    kind === "user"
      ? await run(["id", "-u", value])
      : await run(["getent", "group", value]);
  return {
    name,
    status: result.exitCode === 0 ? "PASS" : "FAIL",
    detail:
      result.exitCode === 0
        ? value
        : firstLine(result.stderr || result.stdout || "missing"),
  };
}

export async function serviceUserReadCheck(
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
      SERVICE_USER,
      "test",
      "-r",
      path,
    ]);
    return {
      name,
      status: result.exitCode === 0 ? "PASS" : "FAIL",
      detail:
        result.exitCode === 0
          ? `readable by ${SERVICE_USER}`
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

export async function pathExists(path: string): Promise<boolean> {
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
