import { expect, test } from "bun:test";

import { evaluateListenerCheck } from "../src/agent/doctor/listener";
import {
  defaultInstallPaths,
  DOKKU_WRAPPER_CONTENTS,
  DOKKU_WRAPPER_PATH,
  renderAvahiService,
  renderSudoers,
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
    `ExecStart=/usr/local/bin/nemo-agent serve --state-dir /var/lib/nemo-agent --host 0.0.0.0 --port 7331 --dokku-wrapper ${DOKKU_WRAPPER_PATH}`,
  );
  expect(renderSystemdUnit(paths)).toContain("User=nemo-agent");
  expect(renderSystemdUnit(paths)).toContain("Group=nemo-agent");
});

test("Avahi service advertises the Nemo agent endpoint", () => {
  const service = renderAvahiService(paths);
  expect(service).toContain("<type>_nemo-agent._tcp</type>");
  expect(service).toContain("<port>7331</port>");
  expect(service).toContain("<txt-record>apiVersion=1</txt-record>");
  expect(service).toContain("<txt-record>path=/</txt-record>");
});

test("sudoers policy only grants the service user access to the wrapper", () => {
  expect(renderSudoers()).toContain(
    `nemo-agent ALL=(root) NOPASSWD: ${DOKKU_WRAPPER_PATH} *`,
  );
});

test("Dokku wrapper validates commands before execing Dokku", () => {
  const wrapper = DOKKU_WRAPPER_CONTENTS;
  expect(wrapper).toContain("nemo-agent: Dokku command is not allowlisted");
  expect(wrapper).toContain('exec dokku "$@"');
  expect(wrapper).toContain('[ "$1" = "logs" ]');
  expect(wrapper).not.toContain("config:set");
});

test("listener check fails loopback listener when expecting all interfaces", () => {
  expect(
    evaluateListenerCheck("0.0.0.0", 7331, [
      "LISTEN 0 511 127.0.0.1:7331 0.0.0.0:*",
    ]),
  ).toMatchObject({
    name: "listener binding",
    status: "FAIL",
    detail: "unsafe listener(s): LISTEN 0 511 127.0.0.1:7331 0.0.0.0:*",
  });
});
