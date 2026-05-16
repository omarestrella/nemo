import { run } from "./process";
import type { Check } from "./types";

export async function listenerCheck(
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
  return evaluateListenerCheck(expectedHost, expectedPort, listeners);
}

export function evaluateListenerCheck(
  expectedHost: string,
  expectedPort: number,
  listeners: string[],
): Check {
  const unsafe = listeners.filter(
    (line) =>
      !line.includes(`${expectedHost}:${expectedPort}`) &&
      !line.includes(`[${expectedHost}]:${expectedPort}`),
  );
  return {
    name: "listener binding",
    status: unsafe.length === 0 ? "PASS" : "FAIL",
    detail:
      unsafe.length === 0
        ? listeners.join("; ")
        : `unsafe listener(s): ${unsafe.join("; ")}`,
  };
}
