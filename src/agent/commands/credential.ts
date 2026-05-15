import { AgentState } from "../storage";
import { stateDir, type ParsedArgs } from "./args";

export async function credentialCommand(parsed: ParsedArgs): Promise<void> {
  const action = parsed.positionals[1] ?? "help";
  const state = await AgentState.open({ stateDir: stateDir(parsed) });

  try {
    switch (action) {
      case "list":
        for (const credential of state.listCredentials()) {
          console.log(
            `${credential.id}\t${credential.scope}\tdevice=${credential.deviceName}\tcreated=${credential.createdAt}\tlast_used=${credential.lastUsedAt ?? "-"}\trevoked=${credential.revokedAt ?? "-"}`,
          );
        }
        return;
      case "revoke": {
        const id = parsed.positionals[2];
        if (!id) {
          throw new Error("credential revoke requires a credential id");
        }
        console.log(state.revokeCredential(id) ? `Revoked ${id}` : `No active credential found for ${id}`);
        return;
      }
      default:
        printCredentialHelp();
        return;
    }
  } finally {
    state.close();
  }
}

function printCredentialHelp(): void {
  console.log("Usage: nemo-agent credential list|revoke [options]");
}
