import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";

import { SERVICE_USER, fileContains } from "../install";
import { firstLine, run } from "./process";
import type { Check } from "./types";

type OwnerDetail = { user: string; group: string };
type PathInspection = { mode: number; owner: OwnerDetail };

export async function modeOwnerCheck(
  name: string,
  path: string,
  expectedMode: number,
  expectedUser: string,
  expectedGroup: string,
): Promise<Check> {
  const inspection = await inspectPath(path);
  if (!inspection) {
    return { name, status: "FAIL", detail: "missing" };
  }
  const ownerOk =
    inspection.owner.user === expectedUser &&
    inspection.owner.group === expectedGroup;
  return {
    name,
    status: inspection.mode === expectedMode && ownerOk ? "PASS" : "FAIL",
    detail: modeOwnerDetail(
      inspection,
      expectedMode,
      expectedUser,
      expectedGroup,
    ),
  };
}

export async function pathCheck(
  name: string,
  path: string,
  executableBits: number,
  warnOnly: boolean,
): Promise<Check> {
  const info = await statPath(path);
  if (!info) {
    return { name, status: warnOnly ? "WARN" : "FAIL", detail: "missing" };
  }
  const mode = info.mode & 0o777;
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
  const inspection = await inspectPath(path);
  if (!inspection) {
    return {
      name,
      status: "WARN",
      detail: "missing; run sudo nemo-agent doctor --fix",
    };
  }
  const ownerOk =
    inspection.owner.user === expectedUser &&
    inspection.owner.group === expectedGroup;
  const contentsOk = await fileContains(path, expectedContents);
  return {
    name,
    status:
      inspection.mode === expectedMode && ownerOk && contentsOk
        ? "PASS"
        : "WARN",
    detail: `${modeOwnerDetail(
      inspection,
      expectedMode,
      expectedUser,
      expectedGroup,
    )}; ${contentsOk ? "contents current" : "contents differ"}`,
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
  if (!(await statPath(path))) {
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

async function statPath(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

async function inspectPath(path: string): Promise<PathInspection | null> {
  const info = await statPath(path);
  if (!info) {
    return null;
  }
  const [user, group] = await Promise.all([
    nameForId("getent", "passwd", info.uid),
    nameForId("getent", "group", info.gid),
  ]);
  return {
    mode: info.mode & 0o777,
    owner: {
      user: user ?? String(info.uid),
      group: group ?? String(info.gid),
    },
  };
}

function modeOwnerDetail(
  inspection: PathInspection,
  expectedMode: number,
  expectedUser: string,
  expectedGroup: string,
): string {
  return `mode ${inspection.mode.toString(8)} expected ${expectedMode.toString(8)}; owner ${inspection.owner.user}:${inspection.owner.group} expected ${expectedUser}:${expectedGroup}`;
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
