import { expect, test } from "bun:test";

import {
  defaultInstallPaths,
  renderAvahiService,
  renderSystemdUnit,
  type InstallPaths,
} from "../src/agent/install";

const paths: InstallPaths = {
  configDir: "/etc/nemo-agent",
  stateDir: "/var/lib/nemo-agent",
  host: "0.0.0.0",
  port: 7331,
};

test("host install defaults to a LAN-reachable listener", () => {
  expect(defaultInstallPaths({ stateDir: "/var/lib/nemo-agent" }).host).toBe(
    "0.0.0.0",
  );
});

test("systemd unit binds the configured listener", () => {
  expect(renderSystemdUnit(paths)).toContain(
    "ExecStart=/usr/local/bin/nemo-agent serve --state-dir /var/lib/nemo-agent --host 0.0.0.0 --port 7331",
  );
});

test("Avahi service advertises the Nemo agent endpoint", () => {
  const service = renderAvahiService(paths);
  expect(service).toContain("<type>_nemo-agent._tcp</type>");
  expect(service).toContain("<port>7331</port>");
  expect(service).toContain("<txt-record>apiVersion=1</txt-record>");
  expect(service).toContain("<txt-record>path=/</txt-record>");
});
