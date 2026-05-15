import { defaultInstallPaths, ensureAgentStateOwnership, ensureHostInstall } from "../install";
import { AgentState, ensureStateLayout, resolveStatePaths } from "../storage";
import { flagInt, flagString, stateDir, type ParsedArgs } from "./args";

export async function initCommand(parsed: ParsedArgs): Promise<void> {
  const paths = resolveStatePaths({ stateDir: stateDir(parsed) });
  const install = await ensureHostInstall(
    defaultInstallPaths({
      stateDir: paths.stateDir,
      host: flagString(parsed, "host") ?? undefined,
      port: flagInt(parsed, "port") ?? undefined,
    }),
  );
  await ensureStateLayout(paths, { repairUnsafe: true });
  const state = await AgentState.open({ stateDir: paths.stateDir, repairUnsafeLayout: true });
  const instanceId = state.getInstanceId();
  state.close();
  await ensureAgentStateOwnership(paths);

  console.log("Nemo agent initialized");
  console.log(`State directory: ${paths.stateDir}`);
  console.log(`Database: ${paths.databasePath}`);
  console.log(`Server secret: ${paths.secretPath}`);
  console.log(`Instance ID: ${instanceId}`);
  for (const entry of install.changed) {
    console.log(`Installed: ${entry}`);
  }
  for (const entry of install.printed) {
    console.log(entry);
  }
}
