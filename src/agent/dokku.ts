import { NemoError } from "./errors";
import type {
  AppLogs,
  AppSummary,
  AppWriteAction,
  AppWriteActionResult,
  DokkuPlatform,
  LogLine,
  PlatformEvent,
  PlatformEvents,
  PlatformVersion,
} from "./types";
import { TaskQueue } from "../utils/task-queue";

const APP_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const MAX_DOKKU_READ_LIMIT = 500;
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
  constructor(
    private readonly runner: IDokkuCommandRunner,
    private readonly writeRunner: IDokkuCommandRunner = runner,
  ) {}

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

  async getAppLogs(app: string, lines: number): Promise<AppLogs> {
    if (!isValidAppName(app)) {
      throw new NemoError("INVALID_APP_NAME", "Invalid app name", {
        status: 400,
      });
    }
    if (!isBoundedPositiveInteger(lines, MAX_DOKKU_READ_LIMIT)) {
      throw new NemoError("BAD_REQUEST", "lines must be between 1 and 500", {
        status: 400,
      });
    }

    const apps = await this.listApps();
    if (!apps.includes(app)) {
      throw new NemoError("NOT_FOUND", "App not found", { status: 404 });
    }

    const result = await this.runRequired([
      "logs",
      app,
      "--num",
      String(lines),
    ]);
    return {
      status: "ok",
      app,
      lines,
      logs: parseLogLines(result.stdout),
      truncated: result.stdoutTruncated,
    };
  }

  async getEvents(limit: number): Promise<PlatformEvents> {
    if (!isBoundedPositiveInteger(limit, MAX_DOKKU_READ_LIMIT)) {
      throw new NemoError("BAD_REQUEST", "limit must be between 1 and 500", {
        status: 400,
      });
    }

    let result: CommandResult;
    try {
      result = await this.runner.run(["events"]);
    } catch (error) {
      if (
        error instanceof NemoError &&
        error.code === "PLATFORM_COMMAND_NOT_ALLOWED"
      ) {
        throw error;
      }
      return unavailableEvents(
        limit,
        error instanceof Error ? error.message : "Platform events unavailable",
        "",
      );
    }

    const raw = result.stdout || result.stderr;
    if (result.timedOut) {
      return unavailableEvents(limit, "Platform events command timed out", raw);
    }
    if (result.exitCode !== 0 || isEventsUnavailableOutput(raw)) {
      return unavailableEvents(
        limit,
        firstNonEmptyLine(result.stderr || result.stdout) ??
          "Platform events unavailable",
        raw,
      );
    }

    return {
      status: "ok",
      limit,
      events: parsePlatformEvents(result.stdout, limit),
      truncated: result.stdoutTruncated,
    };
  }

  async restartApp(app: string): Promise<AppWriteActionResult> {
    return await this.runAppWriteAction(app, "restart", ["ps:restart", app]);
  }

  async rebuildApp(app: string): Promise<AppWriteActionResult> {
    return await this.runAppWriteAction(app, "rebuild", ["ps:rebuild", app]);
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

  private async runAppWriteAction(
    app: string,
    action: AppWriteAction,
    args: string[],
  ): Promise<AppWriteActionResult> {
    if (!isValidAppName(app)) {
      throw new NemoError("INVALID_APP_NAME", "Invalid app name", {
        status: 400,
      });
    }

    const apps = await this.listApps();
    if (!apps.includes(app)) {
      throw new NemoError("NOT_FOUND", "App not found", { status: 404 });
    }

    const result = await this.runWriteRequired(args);
    return {
      status: "ok",
      app,
      action,
      command: result.args,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
    };
  }

  private async runWriteRequired(args: string[]): Promise<CommandResult> {
    const result = await this.writeRunner.run(args);
    if (result.timedOut) {
      throw new NemoError(
        "PLATFORM_COMMAND_TIMEOUT",
        `${args[0] ?? "Dokku command"} timed out`,
        {
          status: 504,
          retryable: true,
          details: commandFailureDetails(result),
        },
      );
    }
    if (result.exitCode !== 0) {
      throw new NemoError(
        "PLATFORM_COMMAND_FAILED",
        firstNonEmptyLine(result.stderr || result.stdout) ??
          "Platform command failed",
        {
          status: 502,
          retryable: true,
          details: commandFailureDetails(result),
        },
      );
    }
    return result;
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
    return isBoundedPositiveIntegerString(args[3] ?? "", MAX_DOKKU_READ_LIMIT);
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
  if (
    args.length === 2 &&
    (args[0] === "ps:restart" || args[0] === "ps:rebuild") &&
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

export function parseLogLines(raw: string): LogLine[] {
  return splitOutputLines(raw).map((line, index) => parseLogLine(line, index));
}

export function parsePlatformEvents(raw: string, limit?: number): PlatformEvent[] {
  const lines = splitOutputLines(raw).filter((line) => line.trim().length > 0);
  const selected = limit === undefined ? lines : lines.slice(-limit);
  return selected.map((line, index) => parsePlatformEvent(line, index));
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

function parseLogLine(raw: string, index: number): LogLine {
  const timestamp = parseFullTimestampPrefix(raw);
  const messageText = timestamp?.rest ?? raw;
  const message = parseSourceMessage(messageText);
  return {
    index,
    raw,
    message: message.message,
    timestamp: timestamp?.timestamp ?? null,
    timestampText: timestamp?.timestampText ?? null,
    source: message.source,
  };
}

function parsePlatformEvent(raw: string, index: number): PlatformEvent {
  const syslog = raw.match(
    /^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([^\s:[\]]+)(?:\[(\d+)])?:\s*(.*)$/,
  );
  if (syslog) {
    const invocation = parseDokkuInvocation(syslog[5] ?? "");
    return {
      index,
      raw,
      message: syslog[5] ?? "",
      timestamp: null,
      timestampText: syslog[1] ?? null,
      host: syslog[2] ?? null,
      source: syslog[3] ?? null,
      pid: syslog[4] ? Number.parseInt(syslog[4], 10) : null,
      action: invocation.action,
      app: invocation.app,
      args: invocation.args,
    };
  }

  const timestamp = parseFullTimestampPrefix(raw);
  const message = timestamp?.rest ?? raw;
  const invocation = parseDokkuInvocation(message);
  return {
    index,
    raw,
    message,
    timestamp: timestamp?.timestamp ?? null,
    timestampText: timestamp?.timestampText ?? null,
    host: null,
    source: null,
    pid: null,
    action: invocation.action,
    app: invocation.app,
    args: invocation.args,
  };
}

function parseFullTimestampPrefix(
  raw: string,
): { timestampText: string; timestamp: string | null; rest: string } | null {
  const match = raw.match(
    /^(\d{4}-\d{2}-\d{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))\s*(.*)$/,
  );
  if (!match) {
    return null;
  }
  return {
    timestampText: match[1] ?? "",
    timestamp: normalizeTimestamp(match[1] ?? ""),
    rest: match[2] ?? "",
  };
}

function normalizeTimestamp(value: string): string | null {
  const normalized = value
    .replace(" ", "T")
    .replace(/\.(\d{3})\d+/, ".$1")
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const time = Date.parse(normalized);
  if (Number.isNaN(time)) {
    return null;
  }
  return new Date(time).toISOString();
}

function parseSourceMessage(raw: string): { source: string | null; message: string } {
  const match = raw
    .trimStart()
    .match(/^([A-Za-z0-9_.-]+(?:\[[A-Za-z0-9_.-]+\])?)(?:\s+\|\s+|:\s+)(.*)$/);
  if (!match) {
    return { source: null, message: raw };
  }
  return {
    source: match[1] ?? null,
    message: match[2] ?? "",
  };
}

function parseDokkuInvocation(message: string): {
  action: string | null;
  app: string | null;
  args: string[];
} {
  const match = message.match(/^INVOKED:\s*([^(]+?)\s*\((.*)\)\s*$/);
  if (!match) {
    return { action: null, app: null, args: [] };
  }

  const args = (match[2] ?? "").trim().split(/\s+/).filter(Boolean);
  const firstArg = args[0] ?? null;
  return {
    action: (match[1] ?? "").trim() || null,
    app: firstArg && isValidAppName(firstArg) ? firstArg : null,
    args,
  };
}

function splitOutputLines(raw: string): string[] {
  const lines = raw.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function isEventsUnavailableOutput(raw: string): boolean {
  const normalized = raw.toLowerCase();
  return [
    "unknown command",
    "not a dokku command",
    "events logger is not enabled",
    "events logger not enabled",
    "events are not enabled",
    "events are disabled",
    "events plugin is not installed",
  ].some((text) => normalized.includes(text));
}

function unavailableEvents(
  limit: number,
  message: string,
  raw: string,
): PlatformEvents {
  return {
    status: "unavailable",
    limit,
    events: [],
    retryable: true,
    message,
    raw,
  };
}

function commandFailureDetails(result: CommandResult): Record<string, unknown> {
  return {
    command: result.args,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
    timedOut: result.timedOut,
  };
}

function isBoundedPositiveInteger(value: number, max: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= max;
}

function isBoundedPositiveIntegerString(value: string, max: number): boolean {
  if (!/^[0-9]+$/.test(value)) {
    return false;
  }
  return isBoundedPositiveInteger(Number(value), max);
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
