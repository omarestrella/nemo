import { hostname } from "node:os";

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
import { flagInt, flagString, stateDir, type ParsedArgs } from "./args";

export async function serveCommand(parsed: ParsedArgs): Promise<void> {
  const state = await AgentState.open({ stateDir: stateDir(parsed) });
  const runner = new DokkuCommandRunner({
    binary: flagString(parsed, "dokku-bin") ?? "dokku",
    timeoutMs: flagInt(parsed, "command-timeout-ms") ?? 8_000,
    outputLimitBytes: flagInt(parsed, "output-limit-bytes") ?? 256 * 1024,
    concurrency: flagInt(parsed, "command-concurrency") ?? 4,
  });
  const dokku = new DokkuAdapter(runner);
  const bindHost = flagString(parsed, "host") ?? "127.0.0.1";
  const port = flagInt(parsed, "port") ?? 7331;
  const publicHost = flagString(parsed, "public-host") ?? hostname();

  const server = Bun.serve({
    hostname: bindHost,
    port,
    routes: {
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
