import {
  DOKKU_WRAPPER_CONTENTS,
  DOKKU_WRAPPER_PATH,
  WRAPPER_DIR,
  INSTALLED_BINARY_PATH,
  SERVICE_GROUP,
  SERVICE_USER,
  SUDOERS_PATH,
  SYSTEMD_UNIT_PATH,
  defaultInstallPaths,
  ensureAgentStateOwnership,
  ensureHostInstall,
  renderSudoers,
  renderSystemdUnit,
} from "../install";
import { AgentState, ensureStateLayout, resolveStatePaths } from "../storage";
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
import { systemdChecks } from "../doctor/systemd";
import type { Check } from "../doctor/types";
import {
  flagBool,
  flagInt,
  flagString,
  stateDir,
  type ParsedArgs,
} from "./args";

type DoctorTask = {
  name: string;
  run: () => Promise<Check | Check[]> | Check | Check[];
};

export async function doctorCommand(parsed: ParsedArgs): Promise<void> {
  const fix = flagBool(parsed, "fix");
  const verbose = flagBool(parsed, "verbose");
  const paths = resolveStatePaths({ stateDir: stateDir(parsed) });
  const installPaths = defaultInstallPaths({
    stateDir: paths.stateDir,
    host: flagString(parsed, "host") ?? undefined,
    port: flagInt(parsed, "port") ?? undefined,
  });

  if (fix) {
    console.log("Repairing Nemo agent host artifacts...");
    await ensureHostInstall(installPaths);
    await ensureStateLayout(paths, { repairUnsafe: true });
    const state = await AgentState.open({
      stateDir: paths.stateDir,
      repairUnsafeLayout: true,
    });
    state.close();
    await ensureAgentStateOwnership(paths);
  }

  const serviceCommand = await serviceDokkuCommandPrefix();
  const tasks: DoctorTask[] = [
    {
      name: "agent version",
      run: () => ({ name: "agent version", status: "PASS", detail: AGENT_VERSION }),
    },
    { name: "compile target", run: () => compileTargetCheck() },
    {
      name: "binary path",
      run: () => pathCheck("binary path", INSTALLED_BINARY_PATH, 0o111, true),
    },
    { name: "effective user", run: () => userChecks() },
    {
      name: "service account",
      run: async () => [
        await accountCheck("service user", SERVICE_USER, "user"),
        await accountCheck("service group", SERVICE_GROUP, "group"),
      ],
    },
    {
      name: "config directory",
      run: () => modeOwnerCheck("config directory", installPaths.configDir, 0o750, "root", "root"),
    },
    {
      name: "state directory",
      run: () => modeOwnerCheck("state directory", paths.stateDir, 0o700, SERVICE_USER, SERVICE_GROUP),
    },
    {
      name: "server secret",
      run: () => modeOwnerCheck("server secret", paths.secretPath, 0o600, SERVICE_USER, SERVICE_GROUP),
    },
    {
      name: "database",
      run: () => modeOwnerCheck("database", paths.databasePath, 0o600, SERVICE_USER, SERVICE_GROUP),
    },
    {
      name: "wrapper directory",
      run: () => modeOwnerCheck("wrapper directory", WRAPPER_DIR, 0o755, "root", "root"),
    },
    {
      name: "Dokku wrapper",
      run: () =>
        fileCheck(
          "Dokku wrapper",
          DOKKU_WRAPPER_PATH,
          DOKKU_WRAPPER_CONTENTS,
          0o755,
          "root",
          "root",
        ),
    },
    {
      name: "sudoers policy",
      run: () => fileCheck("sudoers policy", SUDOERS_PATH, renderSudoers(), 0o440, "root", "root"),
    },
    {
      name: "systemd unit",
      run: () =>
        fileCheck(
          "systemd unit",
          SYSTEMD_UNIT_PATH,
          renderSystemdUnit(installPaths),
          0o644,
          "root",
          "root",
        ),
    },
    {
      name: "service discovery",
      run: () => serviceDiscoveryChecks(installPaths.host, installPaths),
    },
    {
      name: "systemd",
      run: () => systemdChecks(installPaths.host, installPaths.port),
    },
    {
      name: "listener binding",
      run: () => listenerCheck(installPaths.host, installPaths.port),
    },
    { name: "Dokku command", run: () => checkDokku(serviceCommand) },
    { name: "Dokku sudo policy", run: () => serviceDokkuSudoCheck() },
    { name: "Dokku read commands", run: () => readCommandChecks(serviceCommand) },
    {
      name: "state readability",
      run: () => serviceUserReadCheck("pairing and credential database readability", paths.databasePath),
    },
  ];

  const checks = await runChecks(tasks, verbose);
  printChecks(checks, verbose);

  if (checks.some((check) => check.status === "FAIL")) {
    process.exitCode = 1;
  }
}

async function runChecks(tasks: DoctorTask[], verbose: boolean): Promise<Check[]> {
  const reporter = new ProgressReporter(tasks.length);
  const checks: Check[] = [];
  if (!verbose) {
    reporter.start();
  }
  try {
    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index];
      if (!task) {
        continue;
      }
      reporter.task(index + 1, task.name);
      const result = await task.run();
      checks.push(...(Array.isArray(result) ? result : [result]));
    }
  } finally {
    reporter.stop();
  }
  return checks;
}

function printChecks(checks: Check[], verbose: boolean): void {
  const failed = checks.filter((check) => check.status === "FAIL");
  const warned = checks.filter((check) => check.status === "WARN");
  const passed = checks.filter((check) => check.status === "PASS");

  console.log(
    `Doctor complete: ${passed.length} passed, ${warned.length} warnings, ${failed.length} failed.`,
  );

  if (verbose) {
    for (const check of checks) {
      console.log(`${check.status} ${check.name}: ${check.detail}`);
    }
    return;
  }

  for (const check of [...failed, ...warned]) {
    console.log(`${check.status} ${check.name}: ${check.detail}`);
  }
  if (failed.length === 0 && warned.length === 0) {
    console.log("No problems found. Use --verbose to print every check.");
  } else {
    console.log("Use --verbose to print every passing check.");
  }
}

class ProgressReporter {
  private frame = 0;
  private current = "";
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly tty = Boolean(process.stdout.isTTY);
  private readonly frames = ["-", "\\", "|", "/"];

  constructor(private readonly total: number) {}

  start(): void {
    if (!this.tty) {
      process.stdout.write(`Running ${this.total} doctor checks: `);
      return;
    }
    this.interval = setInterval(() => this.render(), 100);
  }

  task(index: number, name: string): void {
    this.current = `[${index}/${this.total}] ${name}`;
    if (!this.tty) {
      process.stdout.write(".");
      return;
    }
    this.render();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.tty) {
      process.stdout.write("\r\x1b[2K");
    } else {
      process.stdout.write("\n");
    }
  }

  private render(): void {
    if (!this.tty || !this.current) {
      return;
    }
    const frame = this.frames[this.frame % this.frames.length] ?? "-";
    this.frame += 1;
    process.stdout.write(`\r\x1b[2K${frame} ${this.current}`);
  }
}
