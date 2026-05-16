import { hostname } from "node:os";

import logoPath from "../web/nemo-app-icon.png" with { type: "file" };
import pairCssPath from "../web/pair.css" with { type: "file" };
import pairHtmlPath from "../web/pair.html" with { type: "file" };
import pairJsPath from "../web/pair.js" with { type: "file" };
import {
  DokkuCommandRunner,
  DokkuAdapter,
  MAX_DOKKU_READ_LIMIT,
  isValidAppName,
} from "../dokku";
import { NemoError } from "../errors";
import { auth, errors, handler } from "../http";
import { AgentState } from "../storage";
import { AGENT_VERSION, API_VERSION } from "../types";
import { randomHex } from "../crypto";
import { flagInt, flagString, stateDir, type ParsedArgs } from "./args";

interface BrowserPairingChallenge {
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

const BROWSER_PAIRING_TTL_SECONDS = 120;
const BROWSER_PAIRING_POLL_INTERVAL_SECONDS = 2;

export async function serveCommand(parsed: ParsedArgs): Promise<void> {
  const state = await AgentState.open({ stateDir: stateDir(parsed) });
  const runner = new DokkuCommandRunner({
    binary: "dokku",
    timeoutMs: flagInt(parsed, "command-timeout-ms") ?? 8_000,
    outputLimitBytes: flagInt(parsed, "output-limit-bytes") ?? 256 * 1024,
    concurrency: flagInt(parsed, "command-concurrency") ?? 4,
  });
  const dokku = new DokkuAdapter(runner);
  const bindHost = flagString(parsed, "host") ?? "0.0.0.0";
  const port = flagInt(parsed, "port") ?? 7331;
  const publicHost = flagString(parsed, "public-host") ?? hostname();
  const browserPairingChallenges = new Map<string, BrowserPairingChallenge>();

  let server: ReturnType<typeof Bun.serve>;
  server = Bun.serve({
    hostname: bindHost,
    port,
    routes: {
      "/pair": {
        GET: () => staticFileResponse(pairHtmlPath, "text/html; charset=utf-8"),
      },
      "/pair.css": {
        GET: () => staticFileResponse(pairCssPath, "text/css; charset=utf-8"),
      },
      "/pair.js": {
        GET: () => staticFileResponse(pairJsPath, "text/javascript; charset=utf-8"),
      },
      "/assets/nemo-mark.png": {
        GET: () => staticFileResponse(logoPath, "image/png"),
      },
      "/v1/pairing/browser/start": {
        POST: handler(errors, async (request) => startBrowserPairing(request, browserPairingChallenges, server)),
      },
      "/v1/pairing/browser/challenge": {
        GET: handler(errors, async (request) => getBrowserPairingChallenge(request, browserPairingChallenges)),
      },
      "/v1/pairing/browser/complete": {
        POST: handler(errors, async (request) => completeBrowserPairing(request, browserPairingChallenges)),
      },
      "/v1/pairing/browser/exchange": {
        POST: handler(
          errors,
          async (request) => await exchangeBrowserPairing(request, state, browserPairingChallenges, publicHost),
        ),
      },
      "/v1/health": {
        GET: () =>
          Response.json({
            status: "ok",
            apiVersion: API_VERSION,
            agentVersion: AGENT_VERSION,
          }),
      },
      "/v1/pairing/exchange": {
        POST: handler(
          errors,
          async (request) => await exchangePairing(request, state, publicHost),
        ),
      },
      "/v1/meta": {
        GET: handler(errors, auth(state, "read:status"), async () => {
          const version = await dokku
            .version()
            .catch(() => ({ version: null }));
          return Response.json({
            apiVersion: API_VERSION,
            agentVersion: AGENT_VERSION,
            instanceId: state.getInstanceId(),
            host: publicHost,
            platform: "dokku",
            platformVersion: version.version,
            capabilities: ["apps", "letsencrypt", "logs", "events"],
          });
        }),
      },
      "/v1/platform/version": {
        GET: handler(errors, auth(state, "read:status"), async () =>
          Response.json(await dokku.version()),
        ),
      },
      "/v1/apps": {
        GET: handler(errors, auth(state, "read:status"), async () => {
          const apps = await dokku.listApps();
          const summaries = await Promise.all(
            apps.map((app) => dokku.getApp(app)),
          );
          return Response.json({ apps: summaries });
        }),
      },
      "/v1/apps/:app/logs": {
        GET: handler(errors, auth(state, "read:logs"), async (request) => {
          const { app } = request.params;
          if (!isValidAppName(app)) {
            throw new NemoError("INVALID_APP_NAME", "Invalid app name", {
              status: 400,
            });
          }
          const lines = parseBoundedQueryParam(request, "lines", 200);
          return Response.json(await dokku.getAppLogs(app, lines));
        }),
      },
      "/v1/apps/:app": {
        GET: handler(errors, auth(state, "read:status"), async (request) => {
          const { app } = request.params;
          if (app.includes("/")) {
            throw new NemoError("NOT_FOUND", "Not found", { status: 404 });
          }
          return Response.json(await dokku.getApp(app));
        }),
      },
      "/v1/events": {
        GET: handler(errors, auth(state, "read:events"), async (request) => {
          const limit = parseBoundedQueryParam(request, "limit", 50);
          return Response.json(await dokku.getEvents(limit));
        }),
      },
      "/v1/*": Response.json(
        {
          error: { code: "NOT_FOUND", message: "Not found", retryable: false },
        },
        { status: 404 },
      ),
    },
  });

  console.log(
    `nemo-agent ${AGENT_VERSION} listening on http://${server.hostname}:${server.port}`,
  );
}

function staticFileResponse(path: string, contentType: string): Response {
  return new Response(Bun.file(path), {
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
    },
  });
}

async function startBrowserPairing(
  request: Request,
  challenges: Map<string, BrowserPairingChallenge>,
  server: ReturnType<typeof Bun.serve>,
): Promise<Response> {
  if (!isTrustedPairingTrigger(request, server)) {
    throw new NemoError(
      "PAIRING_TRIGGER_FORBIDDEN",
      "Browser pairing must be started from a loopback or trusted LAN client.",
      { status: 403 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // The route still returns structured BAD_REQUEST below for missing PKCE fields.
  }

  const codeChallenge = String(body.codeChallenge ?? "");
  const codeChallengeMethod = String(body.codeChallengeMethod ?? "");
  if (codeChallengeMethod !== "S256" || !isValidCodeChallenge(codeChallenge)) {
    throw new NemoError("BAD_REQUEST", "A valid S256 code challenge is required", {
      status: 400,
    });
  }

  const endpoint = safeEndpoint(String(body.endpoint ?? ""), request);
  const deviceName = String(body.deviceName ?? "").trim() || "Nemo Mac";
  const challenge = createBrowserPairingChallenge(endpoint, deviceName, codeChallenge);
  challenges.set(challenge.token, challenge);
  pruneBrowserPairingChallenges(challenges);

  const pairUrl = new URL("/pair", endpoint);
  pairUrl.searchParams.set("challenge", challenge.token);
  return Response.json({
    pairUrl: pairUrl.toString(),
    challenge: challenge.token,
    deviceCode: challenge.token,
    expiresAt: challenge.expiresAt,
    intervalSeconds: BROWSER_PAIRING_POLL_INTERVAL_SECONDS,
  });
}

function getBrowserPairingChallenge(
  request: Request,
  challenges: Map<string, BrowserPairingChallenge>,
): Response {
  pruneBrowserPairingChallenges(challenges);
  const challenge = challengeFromRequest(request, challenges);
  if (!challenge) {
    throw new NemoError("PAIRING_CHALLENGE_NOT_FOUND", "Pairing challenge not found", {
      status: 404,
    });
  }
  if (challenge.approvedAt || challenge.deniedAt) {
    throw new NemoError("PAIRING_CHALLENGE_NOT_FOUND", "Pairing challenge not found", {
      status: 404,
    });
  }
  return Response.json({
    endpoint: challenge.endpoint,
    deviceName: challenge.deviceName,
    status: browserPairingStatus(challenge),
    expiresAt: challenge.expiresAt,
  });
}

async function completeBrowserPairing(
  request: Request,
  challenges: Map<string, BrowserPairingChallenge>,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    throw new NemoError("BAD_REQUEST", "Invalid JSON body", { status: 400 });
  }

  const challengeToken = String(body.challenge ?? "");
  const challenge = getLiveBrowserPairingChallenge(challenges, challengeToken);
  if (!challenge) {
    throw new NemoError("PAIRING_CHALLENGE_NOT_FOUND", "Pairing challenge not found", {
      status: 404,
    });
  }

  if (body.decision !== "approve") {
    challenge.deniedAt = new Date().toISOString();
    return Response.json({ status: "denied" });
  }

  const deviceName = String(body.deviceName ?? "").trim() || challenge.deviceName || "Nemo Mac";
  challenge.approvedAt = new Date().toISOString();
  challenge.approvedDeviceName = deviceName;

  return Response.json({
    status: "approved",
    expiresAt: challenge.expiresAt,
  });
}

async function exchangeBrowserPairing(
  request: Request,
  state: AgentState,
  challenges: Map<string, BrowserPairingChallenge>,
  hostName: string,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    throw new NemoError("BAD_REQUEST", "Invalid JSON body", { status: 400 });
  }

  const token = String(body.deviceCode ?? body.challenge ?? "");
  const challenge = getLiveBrowserPairingChallenge(challenges, token);
  if (!challenge) {
    throw new NemoError("PAIRING_CHALLENGE_NOT_FOUND", "Pairing challenge not found", {
      status: 404,
    });
  }
  if (challenge.deniedAt) {
    throw new NemoError("PAIRING_EXCHANGE_FAILED", "Pairing request was denied", {
      status: 403,
    });
  }
  if (!challenge.approvedAt) {
    throw new NemoError("PAIRING_AUTHORIZATION_PENDING", "Pairing request has not been approved yet", {
      status: 428,
      retryable: true,
    });
  }

  const codeVerifier = String(body.codeVerifier ?? "");
  if (!isValidCodeVerifier(codeVerifier) || codeChallengeS256(codeVerifier) !== challenge.codeChallenge) {
    throw new NemoError("PAIRING_VERIFIER_INVALID", "Pairing verifier did not match this challenge", {
      status: 401,
    });
  }

  challenge.consumed = true;
  challenges.delete(challenge.token);
  const deviceName = String(body.deviceName ?? "").trim() || challenge.approvedDeviceName || challenge.deviceName || "Nemo Device";
  const credential = state.issueCredential({ deviceName, scope: "read" });

  return Response.json({
    credential: credential.token,
    credentialRecord: credential.record,
    server: {
      apiVersion: API_VERSION,
      agentVersion: AGENT_VERSION,
      instanceId: state.getInstanceId(),
      host: hostName,
      platform: "dokku",
    },
  });
}

export function isTrustedPairingTrigger(
  request: Request,
  server: Pick<ReturnType<typeof Bun.serve>, "requestIP">,
): boolean {
  const address = server.requestIP(request)?.address || "";
  return isTrustedPairingAddress(address);
}

function isTrustedPairingAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.") ||
    normalized.startsWith("10.") ||
    normalized.startsWith("192.168.") ||
    normalized.startsWith("169.254.") ||
    normalized.startsWith("fe80:")
  ) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    return isTrustedPairingAddress(normalized.slice("::ffff:".length));
  }
  const parts = normalized.split(".");
  if (parts.length === 4 && parts[0] === "172") {
    const second = Number(parts[1]);
    return Number.isInteger(second) && second >= 16 && second <= 31;
  }
  return false;
}

function createBrowserPairingChallenge(endpoint: string, deviceName: string, codeChallenge: string): BrowserPairingChallenge {
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

function challengeFromRequest(
  request: Request,
  challenges: Map<string, BrowserPairingChallenge>,
): BrowserPairingChallenge | null {
  const token = new URL(request.url).searchParams.get("challenge");
  if (!token) {
    return null;
  }
  const challenge = challenges.get(token);
  if (!challenge || challenge.consumed || challenge.expiresAt <= new Date().toISOString()) {
    challenges.delete(token);
    return null;
  }
  return challenge;
}

function getLiveBrowserPairingChallenge(
  challenges: Map<string, BrowserPairingChallenge>,
  token: string,
): BrowserPairingChallenge | null {
  const challenge = challenges.get(token);
  if (!challenge || challenge.consumed || challenge.expiresAt <= new Date().toISOString()) {
    challenges.delete(token);
    return null;
  }
  return challenge;
}

function pruneBrowserPairingChallenges(challenges: Map<string, BrowserPairingChallenge>): void {
  const now = new Date().toISOString();
  for (const [token, challenge] of challenges) {
    if (challenge.consumed || challenge.expiresAt <= now) {
      challenges.delete(token);
    }
  }
}

function browserPairingStatus(challenge: BrowserPairingChallenge): "pending" | "approved" | "denied" {
  if (challenge.deniedAt) {
    return "denied";
  }
  if (challenge.approvedAt) {
    return "approved";
  }
  return "pending";
}

function isValidCodeChallenge(value: string): boolean {
  return /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

function isValidCodeVerifier(value: string): boolean {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

function codeChallengeS256(verifier: string): string {
  const digest = new Bun.CryptoHasher("sha256").update(verifier).digest();
  return Buffer.from(digest).toString("base64url");
}

function endpointFromRequest(request: Request): string {
  const url = new URL(request.url);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function safeEndpoint(value: string, request: Request): string {
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

function parseBoundedQueryParam(
  request: Request,
  name: string,
  defaultValue: number,
): number {
  const value = new URL(request.url).searchParams.get(name);
  if (value === null) {
    return defaultValue;
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new NemoError(
      "BAD_REQUEST",
      `${name} must be an integer between 1 and ${MAX_DOKKU_READ_LIMIT}`,
      { status: 400 },
    );
  }
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_DOKKU_READ_LIMIT
  ) {
    throw new NemoError(
      "BAD_REQUEST",
      `${name} must be an integer between 1 and ${MAX_DOKKU_READ_LIMIT}`,
      { status: 400 },
    );
  }
  return parsed;
}

async function exchangePairing(
  request: Request,
  state: AgentState,
  hostName: string,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    throw new NemoError("BAD_REQUEST", "Invalid JSON body", { status: 400 });
  }

  const pairingId =
    (body.pairingId as string | undefined) ?? (body.id as string | undefined);
  const code = body.code as string | undefined;
  const deviceName = (body.deviceName as string | undefined) ?? "Nemo Device";

  if (!pairingId || !code) {
    throw new NemoError("BAD_REQUEST", "pairingId and code are required", {
      status: 400,
    });
  }

  const result = await state.exchangePairingSession({
    pairingId,
    code,
    deviceName,
  });
  if (!result.ok || !result.credential || !result.credentialRecord) {
    throw new NemoError("PAIRING_EXCHANGE_FAILED", "Pairing exchange failed", {
      status: 401,
    });
  }

  return Response.json({
    credential: result.credential,
    credentialRecord: result.credentialRecord,
    server: {
      apiVersion: API_VERSION,
      agentVersion: AGENT_VERSION,
      instanceId: state.getInstanceId(),
      host: hostName,
      platform: "dokku",
    },
  });
}
