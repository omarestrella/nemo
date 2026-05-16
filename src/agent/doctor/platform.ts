import { arch, platform } from "node:os";

import { run } from "./process";
import type { Check } from "./types";

export function compileTargetCheck(): Check {
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

export async function userChecks(): Promise<Check[]> {
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
