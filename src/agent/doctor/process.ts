import type { CommandResult } from "./types";

export async function run(
  args: string[],
  timeoutMs = 3_000,
): Promise<CommandResult> {
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

export function firstLine(value: string): string {
  return (
    value
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? value.trim()
  );
}

export function isCommandAccessDenied(output: string): boolean {
  const normalized = output.toLowerCase();
  return (
    normalized.includes("a password is required") ||
    normalized.includes("not in the sudoers") ||
    normalized.includes("permission denied")
  );
}
