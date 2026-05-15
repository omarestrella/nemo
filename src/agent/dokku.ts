import { NemoError } from "./errors";
import type { AppSummary, DokkuPlatform, PlatformVersion } from "./types";
import { TaskQueue } from "../utils/task-queue";

const APP_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 256 * 1024;
const DEFAULT_CONCURRENCY = 4;

export interface CommandResult {
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  timedOut: boolean;
}

export interface IDokkuCommandRunner {
  run(args: string[]): Promise<CommandResult>;
}

export interface RunnerOptions {
  binary?: string;
  commandPrefix?: string[];
  timeoutMs?: number;
  outputLimitBytes?: number;
  concurrency?: number;
}

export class DokkuCommandRunner implements IDokkuCommandRunner {
  private readonly commandPrefix: string[];
  private readonly timeoutMs: number;
  private readonly outputLimitBytes: number;
  private readonly queue: TaskQueue;

  constructor(options: RunnerOptions = {}) {
    this.commandPrefix = options.commandPrefix ?? [options.binary ?? "dokku"];
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.outputLimitBytes =
      options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
    this.queue = new TaskQueue(options.concurrency ?? DEFAULT_CONCURRENCY);
  }

  async run(args: string[]): Promise<CommandResult> {
    assertAllowedDokkuArgs(args);
    return await this.queue.run(async () => await this.runAllowed(args));
  }

  private async runAllowed(args: string[]): Promise<CommandResult> {
    let process: Bun.Subprocess<"ignore", "pipe", "pipe">;
    try {
      process = Bun.spawn([...this.commandPrefix, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        env: {
          PATH: Bun.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: Bun.env.HOME ?? "/tmp",
        },
      });
    } catch (error) {
      throw new NemoError(
        "PLATFORM_COMMAND_FAILED",
        error instanceof Error ? error.message : "Failed to start dokku",
        {
          status: 502,
          retryable: true,
        },
      );
    }

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      process.kill("SIGKILL");
    }, this.timeoutMs);

    const [stdout, stderr, exitCode] = await Promise.all([
      readProcessStream(process.stdout, this.outputLimitBytes),
      readProcessStream(process.stderr, this.outputLimitBytes),
      process.exited,
    ]).finally(() => clearTimeout(timeout));

    return {
      args,
      exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
      timedOut,
    };
  }
}

export class DokkuAdapter implements DokkuPlatform {
  constructor(private readonly runner: IDokkuCommandRunner) {}

  async version(): Promise<PlatformVersion> {
    const result = await this.runRequired(["version"]);
    const raw = result.stdout.trim() || result.stderr.trim();
    return {
      platform: "dokku",
      version: parseDokkuVersion(raw),
      raw,
    };
  }

  async listApps(): Promise<string[]> {
    const result = await this.runRequired(["--quiet", "apps:list"]);
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && isValidAppName(line));
  }

  async getApp(app: string): Promise<AppSummary> {
    if (!isValidAppName(app)) {
      throw new NemoError("INVALID_APP_NAME", "Invalid app name", {
        status: 400,
      });
    }

    const [urls, running, deployed, status, ports, domains, letsEncrypt] =
      await Promise.all([
        this.runOptional(["urls", app]),
        this.runOptional(["ps:report", app, "--running"]),
        this.runOptional(["ps:report", app, "--deployed"]),
        this.runOptional(["ps:report", app, "--status"]),
        this.runOptional(["ports:report", app, "--ports-map"]),
        this.runOptional(["domains:report", app, "--domains-app-vhosts"]),
        this.runOptional(["letsencrypt:active", app]),
      ]);

    return {
      name: app,
      urls: parseUrls(urls?.stdout ?? ""),
      running: parseBoolean(running?.stdout),
      deployed: parseBoolean(deployed?.stdout),
      processCount: null,
      httpsActive: parseBoolean(letsEncrypt?.stdout),
      containerStatus: firstNonEmptyLine(status?.stdout ?? null),
      ports: firstNonEmptyLine(ports?.stdout ?? null),
      domains: parseDomains(domains?.stdout ?? ""),
    };
  }

  private async runRequired(args: string[]): Promise<CommandResult> {
    const result = await this.runner.run(args);
    if (result.timedOut) {
      throw new NemoError(
        "PLATFORM_COMMAND_TIMEOUT",
        "Platform command timed out",
        { status: 504, retryable: true },
      );
    }
    if (result.exitCode !== 0) {
      throw new NemoError(
        "PLATFORM_COMMAND_FAILED",
        "Platform command failed",
        { status: 502, retryable: true },
      );
    }
    return result;
  }

  private async runOptional(args: string[]): Promise<CommandResult | null> {
    try {
      const result = await this.runner.run(args);
      if (result.timedOut || result.exitCode !== 0) {
        return null;
      }
      return result;
    } catch {
      return null;
    }
  }
}

export function isValidAppName(app: string): boolean {
  return APP_NAME_PATTERN.test(app);
}

export function assertAllowedDokkuArgs(args: string[]): void {
  if (isAllowedDokkuArgs(args)) {
    return;
  }
  throw new NemoError(
    "PLATFORM_COMMAND_NOT_ALLOWED",
    "Dokku command is not allowlisted",
    { status: 403 },
  );
}

export function isAllowedDokkuArgs(args: string[]): boolean {
  if (args.length === 1 && args[0] === "version") {
    return true;
  }
  if (args.length === 2 && args[0] === "--quiet" && args[1] === "apps:list") {
    return true;
  }
  if (
    args.length === 2 &&
    args[0] === "urls" &&
    args[1] !== undefined &&
    isValidAppName(args[1])
  ) {
    return true;
  }
  if (args.length === 1 && args[0] === "events") {
    return true;
  }
  if (
    args.length === 4 &&
    args[0] === "logs" &&
    args[1] !== undefined &&
    isValidAppName(args[1]) &&
    args[2] === "--num"
  ) {
    const lines = Number.parseInt(args[3] ?? "", 10);
    return Number.isInteger(lines) && lines > 0 && lines <= 500;
  }
  if (args.length === 3 && args[1] && isValidAppName(args[1])) {
    const [command, , flag] = args;
    return (
      (command === "ps:report" &&
        ["--running", "--deployed", "--status"].includes(flag ?? "")) ||
      (command === "ports:report" && flag === "--ports-map") ||
      (command === "domains:report" && flag === "--domains-app-vhosts")
    );
  }
  if (
    args.length === 2 &&
    args[0] === "letsencrypt:active" &&
    args[1] !== undefined &&
    isValidAppName(args[1])
  ) {
    return true;
  }
  return false;
}

export function parseDokkuVersion(raw: string): string | null {
  const match = raw.match(/\b(?:dokku\s+)?v?(\d+\.\d+\.\d+(?:[-+][^\s]+)?)/i);
  return match?.[1] ?? null;
}

export function parseUrls(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => /^https?:\/\//i.test(value));
}

export function parseDomains(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function parseBoolean(raw: string | null | undefined): boolean | null {
  if (!raw) {
    return null;
  }
  const value = firstNonEmptyLine(raw)?.toLowerCase();
  if (!value) {
    return null;
  }
  if (["true", "yes", "1", "running", "deployed", "active"].includes(value)) {
    return true;
  }
  if (["false", "no", "0", "stopped", "missing", "inactive"].includes(value)) {
    return false;
  }
  return null;
}

function firstNonEmptyLine(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  return (
    raw
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

async function readProcessStream(
  stream: ReadableStream<Uint8Array> | null,
  limitBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!stream) {
    return { text: "", truncated: false };
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }

    const remaining = limitBytes - total;
    if (remaining <= 0) {
      truncated = true;
      await reader.cancel();
      break;
    }

    if (value.byteLength > remaining) {
      chunks.push(value.slice(0, remaining));
      total += remaining;
      truncated = true;
      await reader.cancel();
      break;
    }

    chunks.push(value);
    total += value.byteLength;
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { text: new TextDecoder().decode(merged), truncated };
}
