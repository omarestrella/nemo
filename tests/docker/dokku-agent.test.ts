import { afterEach, beforeEach, describe, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const DOKKU_IMAGE = Bun.env.NEMO_DOKKU_IMAGE ?? "dokku/dokku:0.38.2";
const DOKKU_HOSTNAME = "dokku.test";
const TEST_APP = "nemo-docker-test";
const CONTAINER_AGENT_PATH = "/usr/local/bin/nemo-agent";
const CONTAINER_STATE_DIR = "/var/lib/nemo-agent-test";
const CONTAINER_WRAPPER_PATH = "/usr/local/lib/nemo-agent/dokku-readonly";
const CONTAINER_AGENT_PORT = 7331;
const TEST_DHPARAM_PEM = `-----BEGIN DH PARAMETERS-----
MIIBDAKCAQEAsXw5FQDGCBNe7405/kjr+vnA18tQNDb2NN76hKdtx4c6TGBGMHdL
5eEqPaLuVkOta5TTSSnOlPj8w2OMFoAy0a7+nwe0cVfS/njxAMFyXKFzX2bSuyfb
TEOG7LcswDj+JKVYjtNuWWZL0D3+LsTSSHCDTVv7D1TzF8ol3Jv0EjG2EnAhh/Lg
bICS2mR0f8jMyOsjR+Lz5FMaYD52kT9AxQ/a1FObB1HIblYuhenKnwvHFRuAWY6I
TYfzdOdNGh+DCUpaZrEmzdlIQGk0xfeu7mBXsp9Qab8FnHdswnfTm2mzxMaFF/up
dceLbszznsJHEr2tVZvRz+iJI+Ah/Yjh1wIBAgICAOE=
-----END DH PARAMETERS-----
`;

interface CommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const rootDir = resolve(import.meta.dir, "../..");
const dockerTestDir = resolve(rootDir, ".docker-test");
let containerName = "";
let dokkuDataDir = "";
let containerStarted = false;

describe("nemo-agent Dokku Docker integration", () => {
  beforeEach(async () => {
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    containerName = `nemo-dokku-test-${runId}`;
    dokkuDataDir = resolve(dockerTestDir, `dokku-data-${runId}`);
    containerStarted = false;
    await mkdir(resolve(dokkuDataDir, "etc/nginx"), { recursive: true });
    await Bun.write(
      resolve(dokkuDataDir, "etc/nginx/dhparam.pem"),
      TEST_DHPARAM_PEM,
    );
  });

  afterEach(async () => {
    if (containerStarted && Bun.env.NEMO_DOCKER_KEEP_CONTAINER !== "1") {
      await run(["docker", "container", "rm", "-f", containerName], {
        allowFailure: true,
      });
    }
    if (Bun.env.NEMO_DOCKER_KEEP_CONTAINER !== "1") {
      try {
        await rm(dokkuDataDir, { recursive: true, force: true });
      } catch (error) {
        console.warn(
          `Could not remove ${dokkuDataDir}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  });

  it(
    "pairs and serves real Dokku status over the live HTTP API",
    async () => {
      let proxy: { endpoint: string; stop: () => void } | null = null;
      try {
        await assertDockerAvailable();

        const arch = await detectDockerArch();
        const binaryPath = await buildAgentBinary(arch);
        const platform = dockerPlatformForArch(arch);

        await docker(
          [
            "container",
            "run",
            "-d",
            "--name",
            containerName,
            "--platform",
            platform,
            "--env",
            `DOKKU_HOSTNAME=${DOKKU_HOSTNAME}`,
            "--env",
            "DOKKU_HOST_ROOT=/var/lib/dokku/home/dokku",
            "--env",
            "DOKKU_LIB_HOST_ROOT=/var/lib/dokku/var/lib/dokku",
            "--publish",
            `127.0.0.1::${CONTAINER_AGENT_PORT}`,
            "--volume",
            `${dokkuDataDir}:/mnt/dokku`,
            "--volume",
            "/var/run/docker.sock:/var/run/docker.sock",
            DOKKU_IMAGE,
          ],
          { timeoutMs: 10 * 60_000 },
        );
        containerStarted = true;

        await waitForDokku();
        await docker([
          "cp",
          binaryPath,
          `${containerName}:${CONTAINER_AGENT_PATH}`,
        ]);
        await exec(["chmod", "0755", CONTAINER_AGENT_PATH]);

        await exec([
          CONTAINER_AGENT_PATH,
          "init",
          "--state-dir",
          CONTAINER_STATE_DIR,
        ]);
        await exec(
          [
            CONTAINER_AGENT_PATH,
            "doctor",
            "--fix",
            "--state-dir",
            CONTAINER_STATE_DIR,
          ],
          {
            timeoutMs: 120_000,
          },
        );

        await exec(["dokku", "apps:create", TEST_APP], {
          timeoutMs: 120_000,
        });
        await exec(["dokku", "events:on"], {
          timeoutMs: 120_000,
        });
        await exec(["dokku", "git:from-image", TEST_APP, "nginx:alpine"], {
          timeoutMs: 180_000,
        });
        const appList = await exec(["dokku", "--quiet", "apps:list"]);
        assert(
          appList.stdout
            .split("\n")
            .map((line) => line.trim())
            .includes(TEST_APP),
          "Dokku app was not created",
        );

        const modeOutput = await exec([
          "stat",
          "-c",
          "%a %n",
          CONTAINER_STATE_DIR,
          `${CONTAINER_STATE_DIR}/server-secret`,
          `${CONTAINER_STATE_DIR}/nemo-agent.db`,
          CONTAINER_WRAPPER_PATH,
          "/etc/sudoers.d/nemo-agent",
          "/etc/systemd/system/nemo-agent.service",
        ]);
        assert(
          modeOutput.stdout.includes(`700 ${CONTAINER_STATE_DIR}`),
          "State directory must be mode 700",
        );
        assert(
          modeOutput.stdout.includes(
            `600 ${CONTAINER_STATE_DIR}/server-secret`,
          ),
          "Server secret must be mode 600",
        );
        assert(
          modeOutput.stdout.includes(
            `600 ${CONTAINER_STATE_DIR}/nemo-agent.db`,
          ),
          "Database must be mode 600",
        );
        assert(
          modeOutput.stdout.includes(`755 ${CONTAINER_WRAPPER_PATH}`),
          "Dokku wrapper must be mode 755",
        );
        assert(
          modeOutput.stdout.includes("440 /etc/sudoers.d/nemo-agent"),
          "sudoers rule must be mode 440",
        );
        assert(
          modeOutput.stdout.includes("644 /etc/systemd/system/nemo-agent.service"),
          "systemd unit must be mode 644",
        );

        await exec([CONTAINER_WRAPPER_PATH, "version"]);
        const rejectedCommand = await exec([CONTAINER_WRAPPER_PATH, "config:set", TEST_APP, "A=B"], {
          allowFailure: true,
        });
        assert(
          rejectedCommand.exitCode !== 0,
          "Dokku wrapper must reject non-read-only commands",
        );

        const doctor = await exec(
          [
            CONTAINER_AGENT_PATH,
            "doctor",
            "--state-dir",
            CONTAINER_STATE_DIR,
            "--dokku-bin",
            CONTAINER_WRAPPER_PATH,
          ],
          { timeoutMs: 120_000 },
        );
        assert(
          doctor.stdout.includes("PASS privilege path version"),
          "doctor must execute allowlisted commands through the privilege path",
        );

        await startAgent();
        const endpoint = await endpointUrl();
        await waitForHealth(endpoint);
        proxy = await startPathProxy(endpoint);
        const proxiedEndpoint = proxy.endpoint;
        await waitForHealth(proxiedEndpoint);

        const pairing = await startPairing();
        const exchange = await postJson(`${endpoint}/v1/pairing/exchange`, {
          pairingId: pairing.id,
          code: pairing.code,
          deviceName: "Docker Integration",
        });
        assert(
          typeof exchange.credential === "string",
          "Pairing exchange did not return a credential",
        );
        const credential = exchange.credential as string;

        const meta = await getJson(`${endpoint}/v1/meta`, credential);
        assert(meta.platform === "dokku", "Meta endpoint did not report Dokku");
        assert(
          typeof meta.instanceId === "string" && meta.instanceId.length > 0,
          "Meta endpoint missed instance id",
        );

        const version = await getJson(
          `${endpoint}/v1/platform/version`,
          credential,
        );
        assert(
          version.platform === "dokku",
          "Version endpoint did not report Dokku",
        );
        assert(
          typeof version.raw === "string" && version.raw.length > 0,
          "Version endpoint missed raw output",
        );

        const apps = await getJson(`${endpoint}/v1/apps`, credential);
        assert(
          Array.isArray(apps.apps),
          "Apps endpoint did not return an apps array",
        );
        assert(
          apps.apps.some((app: { name?: string }) => app.name === TEST_APP),
          "Apps endpoint missed test app",
        );

        const app = await getJson(
          `${endpoint}/v1/apps/${TEST_APP}`,
          credential,
        );
        assert(
          app.name === TEST_APP,
          "App detail endpoint returned the wrong app",
        );

        const logs = await getJson(
          `${endpoint}/v1/apps/${TEST_APP}/logs?lines=50`,
          credential,
        );
        assert(logs.status === "ok", "Logs endpoint did not report ok");
        assert(logs.app === TEST_APP, "Logs endpoint returned the wrong app");
        assert(Array.isArray(logs.logs), "Logs endpoint missed logs array");

        const events = await getJson(`${endpoint}/v1/events?limit=50`, credential);
        assert(events.status === "ok", "Events endpoint did not report ok");
        assert(Array.isArray(events.events), "Events endpoint missed events array");

        const proxiedMeta = await getJson(`${proxiedEndpoint}/v1/meta`, credential);
        assert(
          proxiedMeta.instanceId === meta.instanceId,
          "Reverse proxy route did not forward authenticated API requests",
        );
      } catch (error) {
        if (containerStarted) {
          await printDiagnostics();
        }
        throw error;
      } finally {
        proxy?.stop();
      }
    },
    10 * 60_000,
  );
});

async function assertDockerAvailable(): Promise<void> {
  await docker(["version"], { timeoutMs: 30_000 });
}

async function detectDockerArch(): Promise<"x64" | "arm64"> {
  const override = Bun.env.NEMO_DOCKER_PLATFORM;
  if (override?.includes("arm64")) {
    return "arm64";
  }
  if (override?.includes("amd64") || override?.includes("x86_64")) {
    return "x64";
  }

  const output = await docker(["version", "--format", "{{.Server.Arch}}"]);
  const arch = output.stdout.trim();
  if (arch === "arm64" || arch === "aarch64") {
    return "arm64";
  }
  if (arch === "amd64" || arch === "x86_64") {
    return "x64";
  }
  throw new Error(`Unsupported Docker architecture: ${arch}`);
}

async function buildAgentBinary(arch: "x64" | "arm64"): Promise<string> {
  const script = arch === "arm64" ? "build:linux-arm64" : "build:linux-x64";
  await run(["bun", "run", script], { timeoutMs: 120_000 });
  return resolve(
    rootDir,
    "dist",
    arch === "arm64" ? "nemo-agent-linux-arm64" : "nemo-agent-linux-x64",
  );
}

function dockerPlatformForArch(arch: "x64" | "arm64"): string {
  if (Bun.env.NEMO_DOCKER_PLATFORM) {
    return Bun.env.NEMO_DOCKER_PLATFORM;
  }
  return arch === "arm64" ? "linux/arm64" : "linux/amd64";
}

async function waitForDokku(): Promise<void> {
  await waitFor(
    "Dokku runit startup",
    async () => {
      const logs = await docker(["logs", containerName], {
        allowFailure: true,
      });
      return (
        logs.stdout.includes("Runit started") ||
        logs.stderr.includes("Runit started")
      );
    },
    240_000,
    500,
  );

  await waitFor(
    "dokku version",
    async () => {
      const version = await exec(["dokku", "version"], {
        allowFailure: true,
        timeoutMs: 30_000,
      });
      return version.exitCode === 0;
    },
    240_000,
    500,
  );

  await waitFor(
    "Dokku restore hooks",
    async () => {
      const restore = await exec(
        [
          "sh",
          "-lc",
          "ps aux | grep -E 'dokku ps:restore|plugn trigger pre-restore|plugins/.*/pre-restore|bashenv.*pre-restore' | grep -v grep",
        ],
        {
          allowFailure: true,
        },
      );
      return restore.exitCode !== 0;
    },
    240_000,
    500,
  );
}

async function startAgent(): Promise<void> {
  await exec([
    "sh",
    "-lc",
    [
      `rm -f /tmp/nemo-agent.log`,
      `nohup ${CONTAINER_AGENT_PATH} serve --state-dir ${CONTAINER_STATE_DIR} --host 0.0.0.0 --port ${CONTAINER_AGENT_PORT} --public-host ${DOKKU_HOSTNAME} >/tmp/nemo-agent.log 2>&1 &`,
    ].join(" && "),
  ]);
}

async function endpointUrl(): Promise<string> {
  const output = await docker([
    "port",
    containerName,
    `${CONTAINER_AGENT_PORT}/tcp`,
  ]);
  const first = output.stdout.trim().split("\n")[0];
  assert(first, "Docker did not publish the agent port");
  const port = first.split(":").at(-1);
  assert(port, `Could not parse published port from: ${first}`);
  return `http://127.0.0.1:${port}`;
}

async function waitForHealth(endpoint: string): Promise<void> {
  await waitFor(
    "agent health endpoint",
    async () => {
      try {
        const response = await fetch(`${endpoint}/v1/health`);
        if (!response.ok) {
          return false;
        }
        const body = (await response.json()) as { status?: string };
        return body.status === "ok";
      } catch {
        return false;
      }
    },
    60_000,
  );
}

async function startPathProxy(
  targetEndpoint: string,
): Promise<{ endpoint: string; stop: () => void }> {
  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const incoming = new URL(request.url);
      if (incoming.pathname === "/_nemo") {
        return Response.redirect(`${incoming.origin}/_nemo/`, 308);
      }
      if (!incoming.pathname.startsWith("/_nemo/")) {
        return Response.json(
          {
            error: {
              code: "NOT_FOUND",
              message: "Not found",
              retryable: false,
            },
          },
          { status: 404 },
        );
      }
      const target = new URL(targetEndpoint);
      target.pathname = incoming.pathname.slice("/_nemo".length);
      target.search = incoming.search;
      const hasBody = request.method !== "GET" && request.method !== "HEAD";
      return await fetch(target, {
        method: request.method,
        headers: request.headers,
        body: hasBody ? request.body : undefined,
        redirect: "manual",
      });
    },
  });

  return {
    endpoint: `http://${proxy.hostname}:${proxy.port}/_nemo`,
    stop: () => proxy.stop(true),
  };
}

async function startPairing(): Promise<{ id: string; code: string }> {
  const output = await exec([
    CONTAINER_AGENT_PATH,
    "pair",
    "start",
    "--state-dir",
    CONTAINER_STATE_DIR,
    "--name",
    "Docker Integration",
    "--endpoint",
    `http://127.0.0.1:${CONTAINER_AGENT_PORT}`,
  ]);
  const id = output.stdout.match(/^Pairing ID:\s*(.+)$/m)?.[1]?.trim();
  const code = output.stdout.match(/^Nemo pairing code:\s*(.+)$/m)?.[1]?.trim();
  assert(id, `Could not parse pairing id from:\n${output.stdout}`);
  assert(code, `Could not parse pairing code from:\n${output.stdout}`);
  return { id, code };
}

async function getJson(
  url: string,
  credential: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${credential}` },
  });
  const body = await response.json();
  assert(
    response.ok,
    `${url} returned ${response.status}: ${JSON.stringify(body)}`,
  );
  return body as Record<string, unknown>;
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseBody = await response.json();
  assert(
    response.ok,
    `${url} returned ${response.status}: ${JSON.stringify(responseBody)}`,
  );
  return responseBody as Record<string, unknown>;
}

async function exec(
  args: string[],
  options: Partial<RunOptions> = {},
): Promise<CommandOutput> {
  return await docker(["exec", containerName, ...args], options);
}

async function docker(
  args: string[],
  options: Partial<RunOptions> = {},
): Promise<CommandOutput> {
  return await run(["docker", ...args], options);
}

interface RunOptions {
  allowFailure: boolean;
  timeoutMs: number;
}

async function run(
  args: string[],
  options: Partial<RunOptions> = {},
): Promise<CommandOutput> {
  const allowFailure = options.allowFailure ?? false;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const process = Bun.spawn(args, {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: Bun.env,
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    process.kill("SIGKILL");
  }, timeoutMs);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]).finally(() => clearTimeout(timeout));

  if ((exitCode !== 0 || timedOut) && !allowFailure) {
    throw new Error(
      [
        `Command failed${timedOut ? " after timeout" : ""}: ${args.join(" ")}`,
        `exit=${exitCode}`,
        stdout ? `stdout:\n${stdout}` : "",
        stderr ? `stderr:\n${stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return { stdout, stderr, exitCode };
}

async function waitFor(
  name: string,
  check: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 2_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) {
      return;
    }
    await Bun.sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${name}`);
}

async function printDiagnostics(): Promise<void> {
  const [logs, agentLog, ps] = await Promise.all([
    docker(["logs", "--tail", "200", containerName], { allowFailure: true }),
    exec(["sh", "-lc", "cat /tmp/nemo-agent.log 2>/dev/null || true"], {
      allowFailure: true,
    }),
    exec(["ps", "aux"], { allowFailure: true }),
  ]);

  console.error("==== dokku container logs ====");
  console.error(logs.stdout || logs.stderr);
  console.error("==== nemo-agent log ====");
  console.error(agentLog.stdout || agentLog.stderr);
  console.error("==== process list ====");
  console.error(ps.stdout || ps.stderr);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
