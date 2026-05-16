import {
  AVAHI_SERVICE_PATH,
  isLoopbackHost,
  renderAvahiService,
  type InstallPaths,
} from "../install";
import { fileCheck } from "./files";
import { firstLine, run } from "./process";
import type { Check } from "./types";

export async function serviceDiscoveryChecks(
  expectedHost: string,
  installPaths: InstallPaths,
): Promise<Check[]> {
  if (process.platform !== "linux") {
    return [
      {
        name: "service discovery",
        status: "WARN",
        detail: "not running on Linux",
      },
    ];
  }
  if (isLoopbackHost(expectedHost)) {
    return [
      {
        name: "service discovery",
        status: "PASS",
        detail: "skipped for loopback-only listener",
      },
    ];
  }

  const serviceFile = await fileCheck(
    "service discovery file",
    AVAHI_SERVICE_PATH,
    renderAvahiService(installPaths),
    0o644,
    "root",
    "root",
  );
  const avahi = await run(["systemctl", "is-active", "avahi-daemon.service"]);
  const browse = await run(["avahi-browse", "-rt", "_nemo-agent._tcp"], 5_000);
  const browseOutput = `${browse.stdout}\n${browse.stderr}`;
  const browseFound =
    browse.exitCode === 0 &&
    browseOutput.includes("_nemo-agent._tcp") &&
    browseOutput.includes(String(installPaths.port));
  // avahi-browse lives in avahi-utils and is not always installed with the daemon.
  // The daemon journal still tells us whether Avahi loaded and established our service.
  const journal = browseFound
    ? null
    : await run([
        "journalctl",
        "-u",
        "avahi-daemon.service",
        "--no-pager",
        "-n",
        "80",
      ]);
  const journalOutput = `${journal?.stdout ?? ""}\n${journal?.stderr ?? ""}`;
  const journalFound =
    journal?.exitCode === 0 &&
    journalOutput.includes("nemo-agent.service") &&
    journalOutput.includes("successfully established");

  return [
    serviceFile,
    {
      name: "service discovery daemon",
      status: avahi.exitCode === 0 ? "PASS" : "WARN",
      detail:
        avahi.stdout.trim() ||
        avahi.stderr.trim() ||
        "avahi-daemon.service not active",
    },
    {
      name: "service discovery advertisement",
      status: browseFound || journalFound ? "PASS" : "WARN",
      detail: browseFound
        ? firstLine(browseOutput)
        : journalFound
          ? "avahi-daemon established nemo-agent.service"
          : firstLine(browseOutput) ||
            firstLine(journalOutput) ||
            "could not browse _nemo-agent._tcp; verify avahi-utils and mDNS networking",
    },
  ];
}
