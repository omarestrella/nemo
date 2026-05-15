import { Database } from "bun:sqlite";
import { chmod, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Stats } from "node:fs";

import {
  digestCredentialSecret,
  hashPairingCode,
  makeCredentialToken,
  makeId,
  makePairingCode,
  normalizePairingCode,
  parseCredentialToken,
  randomHex,
  scopeAllows,
  timingSafeEqualHex,
  verifyPairingCode,
} from "./crypto";
import type { CredentialScope, PublicCredential, PublicPairingSession } from "./types";

export const DEFAULT_STATE_DIR = "/var/lib/nemo-agent";
export const DEFAULT_CONFIG_PATH = "/etc/nemo-agent/config.json";

const SERVER_SECRET_BYTES = 32;

interface MetadataRow {
  value: string;
}

interface PairingRow {
  id: string;
  code_hash: string;
  scope: string;
  expected_device_name: string | null;
  created_at: string;
  expires_at: string;
  attempts: number;
  max_attempts: number;
  consumed_at: string | null;
  canceled_at: string | null;
}

interface CredentialRow {
  id: string;
  secret_digest: string;
  scope: string;
  device_name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface AgentStateOptions {
  stateDir: string;
  databasePath?: string;
  secretPath?: string;
  repairUnsafeLayout?: boolean;
}

export interface PairingStartOptions {
  expectedDeviceName?: string;
  scope?: string;
  ttlSeconds?: number;
  maxAttempts?: number;
}

export interface PairingExchangeOptions {
  pairingId: string;
  code: string;
  deviceName: string;
}

export interface PairingStartResult {
  id: string;
  code: string;
  expiresAt: string;
  scope: string;
}

export interface PairingExchangeResult {
  ok: boolean;
  credential?: string;
  credentialRecord?: PublicCredential;
  reason?: "invalid" | "expired" | "consumed" | "canceled";
}

export interface StatePaths {
  stateDir: string;
  databasePath: string;
  secretPath: string;
}

export interface EnsureStateLayoutOptions {
  repairUnsafe?: boolean;
}

export function resolveStatePaths(options: AgentStateOptions): StatePaths {
  return {
    stateDir: options.stateDir,
    databasePath: options.databasePath ?? join(options.stateDir, "nemo-agent.db"),
    secretPath: options.secretPath ?? join(options.stateDir, "server-secret"),
  };
}

export async function ensureStateLayout(paths: StatePaths, options: EnsureStateLayoutOptions = {}): Promise<void> {
  const repairUnsafe = options.repairUnsafe ?? false;
  await mkdir(paths.stateDir, { recursive: true, mode: 0o700 });
  await ensureMode(paths.stateDir, 0o700, repairUnsafe);

  if (!(await Bun.file(paths.secretPath).exists())) {
    await Bun.write(paths.secretPath, `${randomHex(SERVER_SECRET_BYTES)}\n`);
    await chmod(paths.secretPath, 0o600);
  } else {
    await ensureMode(paths.secretPath, 0o600, repairUnsafe);
  }
}

export async function inspectPathMode(path: string): Promise<number | null> {
  const info = await statPath(path);
  if (!info) {
    return null;
  }
  return info.mode & 0o777;
}

export class AgentState {
  readonly paths: StatePaths;
  private readonly db: Database;
  private readonly serverSecretHex: string;

  private constructor(paths: StatePaths, db: Database, serverSecretHex: string) {
    this.paths = paths;
    this.db = db;
    this.serverSecretHex = serverSecretHex;
  }

  static async open(options: AgentStateOptions): Promise<AgentState> {
    const paths = resolveStatePaths(options);
    await ensureStateLayout(paths, { repairUnsafe: options.repairUnsafeLayout });
    const serverSecretHex = (await Bun.file(paths.secretPath).text()).trim();
    const databaseExisted = await Bun.file(paths.databasePath).exists();
    const db = new Database(paths.databasePath, { create: true });
    if (!databaseExisted) {
      await chmod(paths.databasePath, 0o600);
    }
    const state = new AgentState(paths, db, serverSecretHex);
    state.migrate();
    state.ensureInstanceId();
    await ensureMode(paths.databasePath, 0o600, options.repairUnsafeLayout ?? false);
    return state;
  }

  close(): void {
    this.db.close();
  }

  migrate(): void {
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS pairing_sessions (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL,
        scope TEXT NOT NULL,
        expected_device_name TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        consumed_at TEXT,
        canceled_at TEXT
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS credentials (
        id TEXT PRIMARY KEY,
        secret_digest TEXT NOT NULL,
        scope TEXT NOT NULL,
        device_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT
      )
    `);
  }

  getInstanceId(): string {
    const row = this.db.query("SELECT value FROM metadata WHERE key = ?").get("instance_id") as MetadataRow | null;
    if (!row) {
      return this.ensureInstanceId();
    }
    return row.value;
  }

  getCounts(): { activePairingSessions: number; activeCredentials: number; revokedCredentials: number } {
    const activePairing = this.db
      .query(
        "SELECT COUNT(*) AS count FROM pairing_sessions WHERE consumed_at IS NULL AND canceled_at IS NULL AND expires_at > ?",
      )
      .get(nowIso()) as { count: number };
    const activeCredentials = this.db
      .query("SELECT COUNT(*) AS count FROM credentials WHERE revoked_at IS NULL")
      .get() as { count: number };
    const revokedCredentials = this.db
      .query("SELECT COUNT(*) AS count FROM credentials WHERE revoked_at IS NOT NULL")
      .get() as { count: number };

    return {
      activePairingSessions: activePairing.count,
      activeCredentials: activeCredentials.count,
      revokedCredentials: revokedCredentials.count,
    };
  }

  async createPairingSession(options: PairingStartOptions = {}): Promise<PairingStartResult> {
    const id = makeId();
    const code = makePairingCode();
    const codeHash = await hashPairingCode(code);
    const now = new Date();
    const ttlSeconds = options.ttlSeconds ?? 600;
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    const scope = options.scope ?? "read";

    this.db
      .query(
        `
        INSERT INTO pairing_sessions (
          id, code_hash, scope, expected_device_name, created_at, expires_at, attempts, max_attempts
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
      `,
      )
      .run(id, codeHash, scope, options.expectedDeviceName ?? null, now.toISOString(), expiresAt, options.maxAttempts ?? 5);

    return {
      id,
      code,
      expiresAt,
      scope,
    };
  }

  listPairingSessions(): PublicPairingSession[] {
    const rows = this.db.query("SELECT * FROM pairing_sessions ORDER BY created_at DESC").all() as PairingRow[];
    return rows.map(publicPairingSession);
  }

  cancelPairingSession(id: string): boolean {
    const result = this.db
      .query("UPDATE pairing_sessions SET canceled_at = ? WHERE id = ? AND consumed_at IS NULL AND canceled_at IS NULL")
      .run(nowIso(), id);
    return result.changes > 0;
  }

  async exchangePairingSession(options: PairingExchangeOptions): Promise<PairingExchangeResult> {
    const row = this.getPairingRow(options.pairingId);
    const now = nowIso();

    if (!row) {
      await fakePairingVerify(options.code);
      return { ok: false, reason: "invalid" };
    }
    if (row.consumed_at) {
      return { ok: false, reason: "consumed" };
    }
    if (row.canceled_at || row.attempts >= row.max_attempts) {
      return { ok: false, reason: "canceled" };
    }
    if (row.expires_at <= now) {
      return { ok: false, reason: "expired" };
    }

    const verified = await verifyPairingCode(options.code, row.code_hash);
    if (!verified) {
      const attempts = row.attempts + 1;
      this.db
        .query(
          `
          UPDATE pairing_sessions
          SET attempts = ?, canceled_at = CASE WHEN ? >= max_attempts THEN ? ELSE canceled_at END
          WHERE id = ?
        `,
        )
        .run(attempts, attempts, now, row.id);
      return { ok: false, reason: attempts >= row.max_attempts ? "canceled" : "invalid" };
    }

    const consumed = this.db
      .query(
        `
        UPDATE pairing_sessions
        SET consumed_at = ?
        WHERE id = ? AND consumed_at IS NULL AND canceled_at IS NULL AND attempts < max_attempts AND expires_at > ?
      `,
      )
      .run(now, row.id, now);
    if (consumed.changes === 0) {
      return { ok: false, reason: "consumed" };
    }

    const credential = this.createCredential({
      deviceName: options.deviceName.trim() || row.expected_device_name || "Nemo Device",
      scope: row.scope,
    });

    return {
      ok: true,
      credential: credential.token,
      credentialRecord: credential.record,
    };
  }

  listCredentials(includeRevoked = true): PublicCredential[] {
    const sql = includeRevoked
      ? "SELECT * FROM credentials ORDER BY created_at DESC"
      : "SELECT * FROM credentials WHERE revoked_at IS NULL ORDER BY created_at DESC";
    return (this.db.query(sql).all() as CredentialRow[]).map(publicCredential);
  }

  revokeCredential(id: string): boolean {
    const result = this.db
      .query("UPDATE credentials SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(nowIso(), id);
    return result.changes > 0;
  }

  authenticateCredential(token: string, requiredScope: CredentialScope): PublicCredential | null {
    const parsed = parseCredentialToken(token);
    if (!parsed) {
      return null;
    }

    const row = this.db.query("SELECT * FROM credentials WHERE id = ?").get(parsed.id) as CredentialRow | null;
    if (!row || row.revoked_at || !scopeAllows(row.scope, requiredScope)) {
      return null;
    }

    const digest = digestCredentialSecret(parsed.secret, this.serverSecretHex);
    if (!timingSafeEqualHex(digest, row.secret_digest)) {
      return null;
    }

    this.db.query("UPDATE credentials SET last_used_at = ? WHERE id = ?").run(nowIso(), row.id);
    return publicCredential({ ...row, last_used_at: nowIso() });
  }

  private ensureInstanceId(): string {
    const existing = this.db.query("SELECT value FROM metadata WHERE key = ?").get("instance_id") as MetadataRow | null;
    if (existing) {
      return existing.value;
    }
    const id = makeId();
    this.db.query("INSERT INTO metadata (key, value) VALUES (?, ?)").run("instance_id", id);
    return id;
  }

  private getPairingRow(id: string): PairingRow | null {
    return this.db.query("SELECT * FROM pairing_sessions WHERE id = ?").get(id) as PairingRow | null;
  }

  private createCredential(options: { deviceName: string; scope: string }): { token: string; record: PublicCredential } {
    const id = makeId();
    const secret = randomHex(32);
    const token = makeCredentialToken(id, secret);
    const digest = digestCredentialSecret(secret, this.serverSecretHex);
    const createdAt = nowIso();

    this.db
      .query(
        `
        INSERT INTO credentials (id, secret_digest, scope, device_name, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      )
      .run(id, digest, options.scope, options.deviceName, createdAt);

    return {
      token,
      record: {
        id,
        scope: options.scope,
        deviceName: options.deviceName,
        createdAt,
        lastUsedAt: null,
        revokedAt: null,
      },
    };
  }
}

function publicPairingSession(row: PairingRow): PublicPairingSession {
  return {
    id: row.id,
    scope: row.scope,
    expectedDeviceName: row.expected_device_name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    consumedAt: row.consumed_at,
    canceledAt: row.canceled_at,
  };
}

function publicCredential(row: CredentialRow): PublicCredential {
  return {
    id: row.id,
    scope: row.scope,
    deviceName: row.device_name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

async function fakePairingVerify(code: string): Promise<void> {
  try {
    normalizePairingCode(code);
  } catch {
    return;
  }
  await Bun.password.hash("000000", {
    algorithm: "argon2id",
    memoryCost: 19_456,
    timeCost: 2,
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

async function ensureMode(path: string, expectedMode: number, repairUnsafe: boolean): Promise<void> {
  const actualMode = await inspectPathMode(path);
  if (actualMode === null) {
    return;
  }
  if (actualMode === expectedMode) {
    return;
  }
  if (!repairUnsafe) {
    throw new Error(
      `${path} has unsafe mode ${actualMode.toString(8)}; expected ${expectedMode.toString(8)}. Run doctor --fix as the owning user to repair.`,
    );
  }
  await chmod(path, expectedMode);
}

async function statPath(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
