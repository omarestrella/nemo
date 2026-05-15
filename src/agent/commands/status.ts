import { hostname } from "node:os";

import { AgentState } from "../storage";
import { AGENT_VERSION, API_VERSION } from "../types";
import { stateDir, type ParsedArgs } from "./args";

export async function statusCommand(parsed: ParsedArgs): Promise<void> {
  const state = await AgentState.open({ stateDir: stateDir(parsed) });
  const counts = state.getCounts();
  console.log(`nemo-agent ${AGENT_VERSION}`);
  console.log(`API version: ${API_VERSION}`);
  console.log(`Host: ${hostname()}`);
  console.log(`Instance ID: ${state.getInstanceId()}`);
  console.log(`State directory: ${state.paths.stateDir}`);
  console.log(`Active pairing sessions: ${counts.activePairingSessions}`);
  console.log(`Active credentials: ${counts.activeCredentials}`);
  console.log(`Revoked credentials: ${counts.revokedCredentials}`);
  state.close();
}
