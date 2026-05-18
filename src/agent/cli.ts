import { parseArgs as parseNodeArgs } from "node:util";

import { credentialCommand } from "./commands/credential";
import { doctorCommand } from "./commands/doctor";
import { printHelp } from "./commands/help";
import { initCommand } from "./commands/init";
import { pairCommand } from "./commands/pair";
import { serveCommand } from "./commands/serve";
import { statusCommand } from "./commands/status";
import { flagBool, type ParsedArgs } from "./commands/args";

export async function main(argv: string[]): Promise<void> {
  try {
    const parsed = parseArgs(argv);
    const command = flagBool(parsed, "help") || flagBool(parsed, "h") ? "help" : (parsed.positionals[0] ?? "help");

    switch (command) {
      case "serve":
        await serveCommand(parsed);
        return;
      case "init":
        await initCommand(parsed);
        return;
      case "doctor":
        await doctorCommand(parsed);
        return;
      case "status":
        await statusCommand(parsed);
        return;
      case "pair":
        await pairCommand(parsed);
        return;
      case "credential":
        await credentialCommand(parsed);
        return;
      case "help":
      case "--help":
      case "-h":
        printHelp();
        return;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const { values, positionals } = parseNodeArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "command-concurrency": { type: "string" },
      "command-timeout-ms": { type: "string" },
      "dokku-wrapper": { type: "string" },
      endpoint: { type: "string" },
      fix: { type: "boolean" },
      h: { type: "boolean" },
      help: { type: "boolean" },
      host: { type: "string" },
      name: { type: "string" },
      "output-limit-bytes": { type: "string" },
      port: { type: "string" },
      "public-host": { type: "string" },
      scope: { type: "string" },
      "state-dir": { type: "string" },
      ttl: { type: "string" },
      verbose: { type: "boolean" },
      "write-command-timeout-ms": { type: "string" },
    },
  });

  return {
    positionals,
    flags: values,
  };
}
