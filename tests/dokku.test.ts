import { expect, test } from "bun:test";

import {
  assertAllowedDokkuArgs,
  isAllowedDokkuArgs,
  isValidAppName,
  parseBoolean,
  parseDokkuVersion,
  parseLogLines,
  parsePlatformEvents,
  parseUrls,
} from "../src/agent/dokku";

test("validates conservative Dokku app names", () => {
  expect(isValidAppName("api")).toBe(true);
  expect(isValidAppName("api-worker-1")).toBe(true);
  expect(isValidAppName("Api")).toBe(false);
  expect(isValidAppName("-api")).toBe(false);
  expect(isValidAppName("api_1")).toBe(false);
  expect(isValidAppName("api;rm")).toBe(false);
});

test("allows only read-only Dokku commands", () => {
  expect(isAllowedDokkuArgs(["--quiet", "apps:list"])).toBe(true);
  expect(isAllowedDokkuArgs(["urls", "api"])).toBe(true);
  expect(isAllowedDokkuArgs(["ps:report", "api", "--running"])).toBe(true);
  expect(isAllowedDokkuArgs(["logs", "api", "--num", "200"])).toBe(true);
  expect(isAllowedDokkuArgs(["logs", "api", "--num", "500"])).toBe(true);
  expect(isAllowedDokkuArgs(["logs", "api", "--num", "0"])).toBe(false);
  expect(isAllowedDokkuArgs(["logs", "api", "--num", "1.5"])).toBe(false);
  expect(isAllowedDokkuArgs(["logs", "api", "--num", "9999"])).toBe(false);
  expect(isAllowedDokkuArgs(["events"])).toBe(true);
  expect(isAllowedDokkuArgs(["config:set", "api", "A=B"])).toBe(false);
  expect(() => assertAllowedDokkuArgs(["run", "api", "bash"])).toThrow();
});

test("parses common Dokku output", () => {
  expect(parseDokkuVersion("dokku version 0.35.18")).toBe("0.35.18");
  expect(parseUrls("http://api.example.com https://api.example.com\n")).toEqual([
    "http://api.example.com",
    "https://api.example.com",
  ]);
  expect(parseBoolean("true\n")).toBe(true);
  expect(parseBoolean("false\n")).toBe(false);
  expect(parseBoolean("unknown\n")).toBeNull();
});

test("parses logs as raw-first lines", () => {
  const logs = parseLogLines(
    "2026-01-02T03:04:05.123456789Z web.1 | hello\nplain line\n",
  );

  expect(logs).toEqual([
    {
      index: 0,
      raw: "2026-01-02T03:04:05.123456789Z web.1 | hello",
      message: "hello",
      timestamp: "2026-01-02T03:04:05.123Z",
      timestampText: "2026-01-02T03:04:05.123456789Z",
      source: "web.1",
    },
    {
      index: 1,
      raw: "plain line",
      message: "plain line",
      timestamp: null,
      timestampText: null,
      source: null,
    },
  ]);
});

test("parses Dokku events without inventing syslog timestamps", () => {
  const events = parsePlatformEvents(
    [
      "Jul  3 16:09:48 dokku.me dokku[127630]: INVOKED: pre-release-buildpack( pythonapp )",
      "Jul  3 16:10:03 dokku.me dokku[128195]: INVOKED: pre-deploy( api 123 web )",
    ].join("\n"),
    1,
  );

  expect(events).toEqual([
    {
      index: 0,
      raw: "Jul  3 16:10:03 dokku.me dokku[128195]: INVOKED: pre-deploy( api 123 web )",
      message: "INVOKED: pre-deploy( api 123 web )",
      timestamp: null,
      timestampText: "Jul  3 16:10:03",
      host: "dokku.me",
      source: "dokku",
      pid: 128195,
      action: "pre-deploy",
      app: "api",
      args: ["api", "123", "web"],
    },
  ]);
});
