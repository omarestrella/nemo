import { DEFAULT_STATE_DIR } from "../storage";

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean | undefined>;
}

export function stateDir(parsed: ParsedArgs): string {
  return flagString(parsed, "state-dir") ?? Bun.env.NEMO_AGENT_STATE_DIR ?? DEFAULT_STATE_DIR;
}

export function flagString(parsed: ParsedArgs, name: string): string | null {
  const value = parsed.flags[name];
  return typeof value === "string" ? value : null;
}

export function flagBool(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags[name] === true;
}

export function flagInt(parsed: ParsedArgs, name: string): number | null {
  const value = flagString(parsed, name);
  if (!value) {
    return null;
  }
  const parsedValue = Number.parseInt(value, 10);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

export function parseTtlSeconds(value: string): number {
  const match = value.match(/^(\d+)([smhd]?)$/);
  if (!match) {
    throw new Error("TTL must be a number with optional s, m, h, or d suffix");
  }
  const amount = Number.parseInt(match[1] ?? "", 10);
  const unit = match[2] || "s";
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
  };
  const multiplier = multipliers[unit];
  if (!multiplier) {
    throw new Error("TTL must use s, m, h, or d suffix");
  }
  return amount * multiplier;
}
