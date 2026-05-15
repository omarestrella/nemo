import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentState } from "../src/agent/storage";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

test("pairing exchange creates a credential and rejects reuse", async () => {
  const state = await openTestState();
  const pairing = await state.createPairingSession({ expectedDeviceName: "Omar MacBook", ttlSeconds: 600 });

  const exchange = await state.exchangePairingSession({
    pairingId: pairing.id,
    code: pairing.code,
    deviceName: "Omar MacBook",
  });

  expect(exchange.ok).toBe(true);
  expect(exchange.credential?.startsWith("nemo_")).toBe(true);
  expect(exchange.credentialRecord?.deviceName).toBe("Omar MacBook");

  const credential = state.authenticateCredential(exchange.credential ?? "", "read:status");
  expect(credential?.id).toBe(exchange.credentialRecord?.id);

  const reused = await state.exchangePairingSession({
    pairingId: pairing.id,
    code: pairing.code,
    deviceName: "Another Device",
  });
  expect(reused.ok).toBe(false);
  expect(reused.reason).toBe("consumed");

  state.close();
});

test("failed pairing attempts cancel a session", async () => {
  const state = await openTestState();
  const pairing = await state.createPairingSession({ maxAttempts: 2 });

  const first = await state.exchangePairingSession({
    pairingId: pairing.id,
    code: "000-000",
    deviceName: "Wrong",
  });
  const second = await state.exchangePairingSession({
    pairingId: pairing.id,
    code: "111-111",
    deviceName: "Wrong",
  });

  expect(first.ok).toBe(false);
  expect(first.reason).toBe("invalid");
  expect(second.ok).toBe(false);
  expect(second.reason).toBe("canceled");

  const session = state.listPairingSessions().find((entry) => entry.id === pairing.id);
  expect(session?.canceledAt).toBeTruthy();

  state.close();
});

test("revoked credentials no longer authenticate", async () => {
  const state = await openTestState();
  const pairing = await state.createPairingSession();
  const exchange = await state.exchangePairingSession({
    pairingId: pairing.id,
    code: pairing.code,
    deviceName: "Test Device",
  });

  expect(exchange.credentialRecord).toBeDefined();
  expect(state.revokeCredential(exchange.credentialRecord?.id ?? "")).toBe(true);
  expect(state.authenticateCredential(exchange.credential ?? "", "read:status")).toBeNull();

  state.close();
});

async function openTestState(): Promise<AgentState> {
  const dir = mkdtempSync(join(tmpdir(), "nemo-state-"));
  cleanupPaths.push(dir);
  return await AgentState.open({ stateDir: dir });
}
