import { expect, test } from "bun:test";

import {
  assertAllowedDokkuArgs,
  isAllowedDokkuArgs,
  isValidAppName,
  parseBoolean,
  parseDokkuVersion,
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
  expect(isAllowedDokkuArgs(["logs", "api", "--num", "9999"])).toBe(false);
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
