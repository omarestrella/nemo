import { AgentState, ensureStateLayout, resolveStatePaths } from "../storage";
import { stateDir, type ParsedArgs } from "./args";

export async function initCommand(parsed: ParsedArgs): Promise<void> {
  const paths = resolveStatePaths({ stateDir: stateDir(parsed) });
  await ensureStateLayout(paths);
  const state = await AgentState.open({ stateDir: paths.stateDir });
  const instanceId = state.getInstanceId();
  state.close();

  console.log("Nemo agent initialized");
  console.log(`State directory: ${paths.stateDir}`);
  console.log(`Database: ${paths.databasePath}`);
  console.log(`Server secret: ${paths.secretPath}`);
  console.log(`Instance ID: ${instanceId}`);
}
