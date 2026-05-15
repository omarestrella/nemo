import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { AgentState } from "../src/agent/storage";

const cleanupPaths: string[] = [];
const processes: Array<Bun.Subprocess<"ignore", "ignore", "ignore">> = [];
const rootDir = resolve(import.meta.dir, "..");

afterEach(async () => {
  for (const process of processes.splice(0)) {
    process.kill();
    await process.exited.catch(() => {});
  }
  for (const path of cleanupPaths.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

test("health is public and meta requires a paired credential", async () => {
  const stateDir = await makeStateDir();
  const url = await startServer(stateDir);

  const health = await fetch(`${url}/v1/health`);
  expect(health.status).toBe(200);
  expect(await health.json()).toMatchObject({ status: "ok", apiVersion: "1" });

  const meta = await fetch(`${url}/v1/meta`);
  expect(meta.status).toBe(401);
});

test("pairing exchange returns a bearer credential that can call meta", async () => {
  const stateDir = await makeStateDir();
  const state = await AgentState.open({ stateDir });
  const pairing = await state.createPairingSession();
  state.close();
  const url = await startServer(stateDir);

  const exchange = await fetch(`${url}/v1/pairing/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pairingId: pairing.id,
      code: pairing.code,
      deviceName: "Test Mac",
    }),
  });
  expect(exchange.status).toBe(200);
  const exchangeBody = (await exchange.json()) as { credential: string };
  expect(exchangeBody.credential.startsWith("nemo_")).toBe(true);

  const meta = await fetch(`${url}/v1/meta`, {
    headers: { authorization: `Bearer ${exchangeBody.credential}` },
  });
  expect(meta.status).toBe(200);
  expect(await meta.json()).toMatchObject({
    apiVersion: "1",
    host: "test-host",
    platform: "dokku",
    platformVersion: null,
    capabilities: ["apps", "letsencrypt", "logs", "events"],
  });
});

test("logs and events require dedicated read scopes", async () => {
  const stateDir = await makeStateDir();
  const dokkuBin = await makeFakeDokku();
  const pairing = await createPairing(stateDir, "read:status");
  const url = await startServer(stateDir, dokkuBin);
  const credential = await exchangeCredential(url, pairing);

  const unauthenticatedLogs = await fetch(`${url}/v1/apps/api/logs?lines=1`);
  expect(unauthenticatedLogs.status).toBe(401);

  const logs = await fetch(`${url}/v1/apps/api/logs?lines=1`, {
    headers: { authorization: `Bearer ${credential}` },
  });
  expect(logs.status).toBe(401);

  const events = await fetch(`${url}/v1/events?limit=1`, {
    headers: { authorization: `Bearer ${credential}` },
  });
  expect(events.status).toBe(401);
});

test("logs and events return raw-first API models", async () => {
  const stateDir = await makeStateDir();
  const dokkuBin = await makeFakeDokku();
  const pairing = await createPairing(stateDir);
  const url = await startServer(stateDir, dokkuBin);
  const credential = await exchangeCredential(url, pairing);

  const logs = await getJson(`${url}/v1/apps/api/logs?lines=2`, credential);
  expect(logs).toMatchObject({
    status: "ok",
    app: "api",
    lines: 2,
    truncated: false,
    logs: [
      {
        index: 0,
        raw: "2026-01-02T03:04:05.123456789Z web.1 | hello from api",
        message: "hello from api",
        timestamp: "2026-01-02T03:04:05.123Z",
        timestampText: "2026-01-02T03:04:05.123456789Z",
        source: "web.1",
      },
      {
        index: 1,
        raw: "plain api line",
        message: "plain api line",
        timestamp: null,
        timestampText: null,
        source: null,
      },
    ],
  });

  const events = await getJson(`${url}/v1/events?limit=1`, credential);
  expect(events).toMatchObject({
    status: "ok",
    limit: 1,
    truncated: false,
    events: [
      {
        index: 0,
        raw: "Jul  3 16:10:03 dokku.me dokku[128195]: INVOKED: pre-deploy( api 123 web )",
        message: "INVOKED: pre-deploy( api 123 web )",
        timestamp: null,
        timestampText: "Jul  3 16:10:03",
        host: "dokku.me",
        source: "dokku",
        pid: 128195,
        action: "pre-deploy",
        app: "api",
        args: ["api", "123", "web"],
      },
    ],
  });
});

test("logs and events validate bounded query params", async () => {
  const stateDir = await makeStateDir();
  const dokkuBin = await makeFakeDokku();
  const pairing = await createPairing(stateDir);
  const url = await startServer(stateDir, dokkuBin);
  const credential = await exchangeCredential(url, pairing);

  for (const path of [
    "/v1/apps/api/logs?lines=0",
    "/v1/apps/api/logs?lines=1.5",
    "/v1/apps/api/logs?lines=501",
    "/v1/events?limit=abc",
    "/v1/events?limit=501",
  ]) {
    const response = await fetch(`${url}${path}`, {
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "BAD_REQUEST", retryable: false },
    });
  }
});

test("logs returns not found before invoking Dokku for absent apps", async () => {
  const stateDir = await makeStateDir();
  const dokkuBin = await makeFakeDokku();
  const pairing = await createPairing(stateDir);
  const url = await startServer(stateDir, dokkuBin);
  const credential = await exchangeCredential(url, pairing);

  const response = await fetch(`${url}/v1/apps/missing/logs?lines=1`, {
    headers: { authorization: `Bearer ${credential}` },
  });
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({
    error: { code: "NOT_FOUND", retryable: false },
  });
});

test("events reports unsupported platform status without crashing", async () => {
  const stateDir = await makeStateDir();
  const dokkuBin = await makeFakeDokku({ eventsUnavailable: true });
  const pairing = await createPairing(stateDir);
  const url = await startServer(stateDir, dokkuBin);
  const credential = await exchangeCredential(url, pairing);

  const events = await getJson(`${url}/v1/events`, credential);
  expect(events).toMatchObject({
    status: "unavailable",
    limit: 50,
    events: [],
    retryable: true,
  });
  expect(String(events.raw)).toContain("unknown command");
});

async function makeStateDir(): Promise<string> {
  const stateDir = await mkdtemp(join(tmpdir(), "nemo-http-"));
  cleanupPaths.push(stateDir);
  return stateDir;
}

async function startServer(
  stateDir: string,
  dokkuBin = "/bin/false",
): Promise<string> {
  const port = await findFreePort();
  const process = Bun.spawn(
    [
      "bun",
      "src/index.ts",
      "serve",
      "--state-dir",
      stateDir,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--public-host",
      "test-host",
      "--dokku-bin",
      dokkuBin,
    ],
    {
      cwd: rootDir,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    },
  );
  processes.push(process);

  const url = `http://127.0.0.1:${port}`;
  await waitForHealth(url);
  return url;
}

async function createPairing(
  stateDir: string,
  scope = "read",
): Promise<{ id: string; code: string }> {
  const state = await AgentState.open({ stateDir });
  const pairing = await state.createPairingSession({ scope });
  state.close();
  return pairing;
}

async function exchangeCredential(
  url: string,
  pairing: { id: string; code: string },
): Promise<string> {
  const exchange = await fetch(`${url}/v1/pairing/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pairingId: pairing.id,
      code: pairing.code,
      deviceName: "Test Mac",
    }),
  });
  expect(exchange.status).toBe(200);
  const body = (await exchange.json()) as { credential: string };
  return body.credential;
}

async function getJson(
  url: string,
  credential: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${credential}` },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

async function makeFakeDokku(
  options: { eventsUnavailable?: boolean } = {},
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nemo-fake-dokku-"));
  cleanupPaths.push(dir);
  const path = join(dir, "dokku");
  const eventsCase = options.eventsUnavailable
    ? "printf '%s\\n' 'dokku: unknown command: events' >&2; exit 1"
    : `printf '%s' ${shSingleQuote(
        [
          "Jul  3 16:09:48 dokku.me dokku[127630]: INVOKED: pre-release-buildpack( pythonapp )",
          "Jul  3 16:10:03 dokku.me dokku[128195]: INVOKED: pre-deploy( api 123 web )",
          "",
        ].join("\n"),
      )}`;
  await Bun.write(
    path,
    `#!/bin/sh
set -eu

case "$*" in
  "version")
    printf '%s\\n' 'dokku version 0.38.2'
    ;;
  "--quiet apps:list")
    printf '%s\\n' 'api'
    ;;
  "logs api --num 1"|"logs api --num 2"|"logs api --num 200")
    printf '%s' '2026-01-02T03:04:05.123456789Z web.1 | hello from api
plain api line
'
    ;;
  "events")
    ${eventsCase}
    ;;
  *)
    printf '%s\\n' "unexpected dokku args: $*" >&2
    exit 1
    ;;
esac
`,
  );
  await chmod(path, 0o755);
  return path;
}

function shSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

async function findFreePort(): Promise<number> {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("ok"),
  });
  const port = server.port;
  server.stop(true);
  if (port === undefined) {
    throw new Error("Bun did not assign a TCP port");
  }
  return port;
}

async function waitForHealth(url: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5_000) {
    try {
      const response = await fetch(`${url}/v1/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for ${url}/v1/health`);
}
