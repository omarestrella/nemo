import { randomHex } from "./crypto";

const PKCE_VALUE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const BROWSER_PAIRING_TTL_SECONDS = 120;

export interface BrowserPairingChallenge {
  token: string;
  endpoint: string;
  deviceName: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  createdAt: string;
  expiresAt: string;
  consumed: boolean;
  approvedAt: string | null;
  deniedAt: string | null;
  approvedDeviceName: string | null;
}

export function isValidPkceValue(value: string): boolean {
  return PKCE_VALUE_PATTERN.test(value);
}

export function codeChallengeS256(verifier: string): string {
  const digest = new Bun.CryptoHasher("sha256").update(verifier).digest();
  return Buffer.from(digest).toString("base64url");
}

export function endpointFromRequest(request: Request): string {
  const url = new URL(request.url);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function safeEndpoint(value: string, request: Request): string {
  try {
    const endpoint = new URL(value);
    if (endpoint.protocol === "http:" || endpoint.protocol === "https:") {
      endpoint.pathname = endpoint.pathname.replace(/\/pair$/, "");
      endpoint.search = "";
      endpoint.hash = "";
      return endpoint.toString().replace(/\/$/, "");
    }
  } catch {
    // Fall back to the request origin below.
  }
  return endpointFromRequest(request);
}

export function createBrowserPairingChallenge(endpoint: string, deviceName: string, codeChallenge: string): BrowserPairingChallenge {
  const now = new Date();
  return {
    token: randomHex(32),
    endpoint,
    deviceName,
    codeChallenge,
    codeChallengeMethod: "S256",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + BROWSER_PAIRING_TTL_SECONDS * 1000).toISOString(),
    consumed: false,
    approvedAt: null,
    deniedAt: null,
    approvedDeviceName: null,
  };
}
