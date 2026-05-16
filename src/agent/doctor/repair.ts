import {
  ensureAgentStateOwnership,
  ensureHostInstall,
  type InstallPaths,
} from "../install";
import { AgentState, ensureStateLayout, type StatePaths } from "../storage";

export async function repairDoctorState(
  paths: StatePaths,
  installPaths: InstallPaths,
): Promise<void> {
  await ensureHostInstall(installPaths);
  await ensureStateLayout(paths, { repairUnsafe: true });
  const state = await AgentState.open({
    stateDir: paths.stateDir,
    repairUnsafeLayout: true,
  });
  state.close();
  await ensureAgentStateOwnership(paths);
}
