import { AgentState } from "../storage";
import { flagString, parseTtlSeconds, stateDir, type ParsedArgs } from "./args";

export async function pairCommand(parsed: ParsedArgs): Promise<void> {
  const action = parsed.positionals[1] ?? "help";
  const state = await AgentState.open({ stateDir: stateDir(parsed) });

  try {
    switch (action) {
      case "start": {
        const session = await state.createPairingSession({
          expectedDeviceName: flagString(parsed, "name") ?? undefined,
          scope: flagString(parsed, "scope") ?? "read",
          ttlSeconds: parseTtlSeconds(flagString(parsed, "ttl") ?? "10m"),
        });
        console.log(`Nemo pairing code: ${session.code}`);
        if (flagString(parsed, "endpoint")) {
          const uri = new URL("nemo://pair");
          uri.searchParams.set("endpoint", flagString(parsed, "endpoint") ?? "");
          uri.searchParams.set("id", session.id);
          uri.searchParams.set("code", session.code);
          console.log(`Setup URI: ${uri.toString()}`);
        }
        console.log(`Pairing ID: ${session.id}`);
        console.log(`Scope: ${session.scope}`);
        console.log(`Expires: ${session.expiresAt}`);
        return;
      }
      case "list":
        for (const session of state.listPairingSessions()) {
          console.log(
            `${session.id}\t${session.scope}\texpires=${session.expiresAt}\tattempts=${session.attempts}/${session.maxAttempts}\tconsumed=${session.consumedAt ?? "-"}\tcanceled=${session.canceledAt ?? "-"}`,
          );
        }
        return;
      case "cancel": {
        const id = parsed.positionals[2];
        if (!id) {
          throw new Error("pair cancel requires a pairing id");
        }
        console.log(state.cancelPairingSession(id) ? `Canceled ${id}` : `No active pairing session found for ${id}`);
        return;
      }
      default:
        printPairHelp();
        return;
    }
  } finally {
    state.close();
  }
}

function printPairHelp(): void {
  console.log("Usage: nemo-agent pair start|list|cancel [options]");
}
