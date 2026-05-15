import { timingSafeEqual } from "node:crypto";

import type { CredentialScope } from "./types";

const CREDENTIAL_PREFIX = "nemo";
const ID_BYTES = 16;

export function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Buffer.from(buffer).toString("hex");
}

export function makeId(): string {
  return randomHex(ID_BYTES);
}

export function makePairingCode(): string {
  const value = (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % 1_000_000;
  return formatPairingCode(value.toString().padStart(6, "0"));
}

export function normalizePairingCode(code: string): string {
  const digits = code.replaceAll(/\D/g, "");
  if (digits.length !== 6) {
    throw new Error("Pairing code must contain exactly 6 digits");
  }
  return digits;
}

export function formatPairingCode(code: string): string {
  const normalized = normalizePairingCode(code);
  return `${normalized.slice(0, 3)}-${normalized.slice(3)}`;
}

export async function hashPairingCode(code: string): Promise<string> {
  return await Bun.password.hash(normalizePairingCode(code), {
    algorithm: "argon2id",
    memoryCost: 19_456,
    timeCost: 2,
  });
}

export async function verifyPairingCode(code: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(normalizePairingCode(code), hash);
  } catch {
    return false;
  }
}

export function makeCredentialToken(id: string, secret: string): string {
  return `${CREDENTIAL_PREFIX}_${id}_${secret}`;
}

export function parseCredentialToken(token: string): { id: string; secret: string } | null {
  if (!token.startsWith(`${CREDENTIAL_PREFIX}_`)) {
    return null;
  }

  const remainder = token.slice(CREDENTIAL_PREFIX.length + 1);
  const separatorIndex = remainder.lastIndexOf("_");
  if (separatorIndex <= 0 || separatorIndex === remainder.length - 1) {
    return null;
  }

  return {
    id: remainder.slice(0, separatorIndex),
    secret: remainder.slice(separatorIndex + 1),
  };
}

export function digestCredentialSecret(secret: string, serverSecretHex: string): string {
  const key = Buffer.from(serverSecretHex, "hex");
  return new Bun.CryptoHasher("sha256", key).update(secret).digest("hex");
}

export function timingSafeEqualHex(left: string, right: string): boolean {
  try {
    const leftBuffer = Buffer.from(left, "hex");
    const rightBuffer = Buffer.from(right, "hex");
    if (leftBuffer.length !== rightBuffer.length) {
      timingSafeEqual(leftBuffer, leftBuffer);
      return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
  } catch {
    return false;
  }
}

export function scopeAllows(granted: string, required: CredentialScope): boolean {
  const scopes = granted.split(/[\s,]+/).filter(Boolean);
  if (scopes.includes(required)) {
    return true;
  }
  return scopes.includes("read") && required.startsWith("read:");
}
