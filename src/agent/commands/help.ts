import { AGENT_VERSION } from "../types";

export function printHelp(): void {
  console.log(`nemo-agent ${AGENT_VERSION}

Usage:
  nemo-agent init [--state-dir PATH]
  nemo-agent doctor [--fix] [--verbose] [--state-dir PATH]
  nemo-agent status [--state-dir PATH]
  nemo-agent serve [--state-dir PATH] [--host 0.0.0.0] [--port 7331] [--dokku-helper PATH]
  nemo-agent pair start --name "Device" [--ttl 10m] [--endpoint URL]
  nemo-agent pair list
  nemo-agent pair cancel <pairing-id>
  nemo-agent credential list
  nemo-agent credential revoke <credential-id>`);
}
