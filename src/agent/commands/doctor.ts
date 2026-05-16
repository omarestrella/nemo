import {
  DOKKU_READONLY_HELPER_PATH,
  HELPER_DIR,
  INSTALLED_BINARY_PATH,
  SERVICE_GROUP,
  SERVICE_USER,
  SUDOERS_PATH,
  SYSTEMD_UNIT_PATH,
  defaultInstallPaths,
  renderDokkuReadonlyHelper,
  renderSudoers,
  renderSystemdUnit,
} from "../install";
import { resolveStatePaths } from "../storage";
import { AGENT_VERSION } from "../types";
import {
  checkDokku,
  readCommandChecks,
  serviceDokkuCommandPrefix,
  serviceDokkuSudoCheck,
} from "../doctor/dokku";
import { serviceDiscoveryChecks } from "../doctor/discovery";
import {
  accountCheck,
  fileCheck,
  modeOwnerCheck,
  pathCheck,
  serviceUserReadCheck,
} from "../doctor/files";
import { listenerCheck } from "../doctor/listener";
import { compileTargetCheck, userChecks } from "../doctor/platform";
import { repairDoctorState } from "../doctor/repair";
import { systemdChecks } from "../doctor/systemd";
import type { Check } from "../doctor/types";
import {
  flagBool,
  flagInt,
  flagString,
  stateDir,
  type ParsedArgs,
} from "./args";

export { evaluateListenerCheck } from "../doctor/listener";

export async function doctorCommand(parsed: ParsedArgs): Promise<void> {
  const fix = flagBool(parsed, "fix");
  const paths = resolveStatePaths({ stateDir: stateDir(parsed) });
  const installPaths = defaultInstallPaths({
    stateDir: paths.stateDir,
    host: flagString(parsed, "host") ?? undefined,
    port: flagInt(parsed, "port") ?? undefined,
  });

  if (fix) {
    await repairDoctorState(paths, installPaths);
  }

  const checks: Check[] = [
    { name: "agent version", status: "PASS", detail: AGENT_VERSION },
    compileTargetCheck(),
    await pathCheck("binary path", INSTALLED_BINARY_PATH, 0o111, true),
    ...(await userChecks()),
    await accountCheck("service user", SERVICE_USER, "user"),
    await accountCheck("service group", SERVICE_GROUP, "group"),
    await modeOwnerCheck(
      "config directory",
      installPaths.configDir,
      0o750,
      "root",
      "root",
    ),
    await modeOwnerCheck(
      "state directory",
      paths.stateDir,
      0o700,
      SERVICE_USER,
      SERVICE_GROUP,
    ),
    await modeOwnerCheck(
      "server secret",
      paths.secretPath,
      0o600,
      SERVICE_USER,
      SERVICE_GROUP,
    ),
    await modeOwnerCheck(
      "database",
      paths.databasePath,
      0o600,
      SERVICE_USER,
      SERVICE_GROUP,
    ),
    await modeOwnerCheck("helper directory", HELPER_DIR, 0o755, "root", "root"),
    await fileCheck(
      "Dokku read helper",
      DOKKU_READONLY_HELPER_PATH,
      renderDokkuReadonlyHelper(),
      0o755,
      "root",
      "root",
    ),
    await fileCheck(
      "sudoers policy",
      SUDOERS_PATH,
      renderSudoers(),
      0o440,
      "root",
      "root",
    ),
    await fileCheck(
      "systemd unit",
      SYSTEMD_UNIT_PATH,
      renderSystemdUnit(installPaths),
      0o644,
      "root",
      "root",
    ),
    ...(await serviceDiscoveryChecks(installPaths.host, installPaths)),
    ...(await systemdChecks(installPaths.host, installPaths.port)),
    await listenerCheck(installPaths.host, installPaths.port),
  ];

  const serviceCommand = await serviceDokkuCommandPrefix();
  checks.push(await checkDokku(serviceCommand));
  checks.push(await serviceDokkuSudoCheck());
  checks.push(...(await readCommandChecks(serviceCommand)));
  checks.push(
    await serviceUserReadCheck(
      "pairing and credential database readability",
      paths.databasePath,
    ),
  );

  printChecks(checks);

  if (checks.some((check) => check.status === "FAIL")) {
    process.exitCode = 1;
  }
}

function printChecks(checks: Check[]): void {
  for (const check of checks) {
    console.log(`${check.status} ${check.name}: ${check.detail}`);
  }
}
