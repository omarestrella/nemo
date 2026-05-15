import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
    rmSync(path, { recursive: true, force: true });
  }
});

test("health is public and meta requires a paired credential", async () => {
  const stateDir = makeStateDir();
  const url = await startServer(stateDir);

  const health = await fetch(`${url}/v1/health`);
  expect(health.status).toBe(200);
  expect(await health.json()).toMatchObject({ status: "ok", apiVersion: "1" });

  const meta = await fetch(`${url}/v1/meta`);
  expect(meta.status).toBe(401);
});

test("pairing exchange returns a bearer credential that can call meta", async () => {
  const stateDir = makeStateDir();
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
  });
});

function makeStateDir(): string {
  const stateDir = mkdtempSync(join(tmpdir(), "nemo-http-"));
  cleanupPaths.push(stateDir);
  return stateDir;
}

async function startServer(stateDir: string): Promise<string> {
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
      "/bin/false",
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
