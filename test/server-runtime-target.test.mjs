import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertRuntimeMatchesTarget,
  invalidUrlPayloadForTarget,
  resolveRuntimeTarget,
  runtimeSessionManagerForTarget,
} from "../dist/server/runtime-target.js";
import { setLastCwd } from "../dist/server/workspace-store.js";

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-webui-runtime-target-"));
  const homeDir = join(root, "home");
  const cwd = join(homeDir, "project");
  const otherCwd = join(homeDir, "other");
  const sessionDir = join(root, "sessions");
  const agentDir = join(root, "agent");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(otherCwd, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  return {
    root,
    homeDir,
    cwd,
    otherCwd,
    sessionDir,
    agentDir,
    policy: { homeDir, allowAnyCwd: false },
  };
}

function writeSessionFile(path, cwd, extra = []) {
  const header = {
    type: "session",
    version: 3,
    id: `session-${Math.random().toString(16).slice(2)}`,
    timestamp: "2026-01-02T03:04:05.000Z",
    cwd,
  };
  writeFileSync(path, [JSON.stringify(header), ...extra.map((entry) => JSON.stringify(entry))].join("\n") + "\n");
}

function resolveWithFixture(fixture, urlState) {
  return resolveRuntimeTarget({
    urlState,
    agentDir: fixture.agentDir,
    sessionDir: fixture.sessionDir,
    policy: fixture.policy,
  });
}

test("resolveRuntimeTarget requires cwd when no URL state and no lastCwd exist", async () => {
  const fixture = makeFixture();
  const target = await resolveWithFixture(fixture, { kind: "new" });
  assert.equal(target.kind, "cwd_required");
  assert.match(target.message, /working directory/);
});

test("resolveRuntimeTarget uses a valid lastCwd for new URL state", async () => {
  const fixture = makeFixture();
  setLastCwd(fixture.agentDir, fixture.cwd);
  const target = await resolveWithFixture(fixture, { kind: "new" });
  assert.deepEqual(target, { kind: "cwd", cwd: fixture.cwd, source: "lastCwd" });
});

test("resolveRuntimeTarget requires cwd when lastCwd was deleted", async () => {
  const fixture = makeFixture();
  setLastCwd(fixture.agentDir, fixture.cwd);
  rmSync(fixture.cwd, { recursive: true });
  const target = await resolveWithFixture(fixture, { kind: "new" });
  assert.equal(target.kind, "cwd_required");
  assert.equal(target.value, fixture.cwd);
  assert.match(target.message, /Saved working directory is unavailable/);
  assert.match(target.message, /path does not exist/);
});

test("resolveRuntimeTarget requires cwd when lastCwd is outside policy", async () => {
  const fixture = makeFixture();
  const outside = join(fixture.root, "outside");
  mkdirSync(outside, { recursive: true });
  setLastCwd(fixture.agentDir, outside);
  const target = await resolveWithFixture(fixture, { kind: "new" });
  assert.equal(target.kind, "cwd_required");
  assert.equal(target.value, outside);
  assert.match(target.message, /path must be inside/);
});

test("resolveRuntimeTarget returns URL cwd without inspecting lastCwd", async () => {
  const fixture = makeFixture();
  setLastCwd(fixture.agentDir, join(fixture.homeDir, "deleted"));
  const target = await resolveWithFixture(fixture, { kind: "cwd", cwd: fixture.otherCwd });
  assert.deepEqual(target, { kind: "cwd", cwd: fixture.otherCwd, source: "url" });
});

test("resolveRuntimeTarget returns URL session target with header cwd", async () => {
  const fixture = makeFixture();
  const sessionPath = join(fixture.root, "existing.jsonl");
  writeSessionFile(sessionPath, fixture.otherCwd);
  const target = await resolveWithFixture(fixture, { kind: "session", sessionPath });
  assert.deepEqual(target, {
    kind: "session",
    source: "url",
    sessionPath,
    cwd: fixture.otherCwd,
  });
});

test("resolveRuntimeTarget returns invalid URL target for parsed invalid cwd state", async () => {
  const fixture = makeFixture();
  const target = await resolveWithFixture(fixture, {
    kind: "invalid",
    invalidKind: "cwd",
    value: "relative",
    message: "Could not open URL working directory: path must be absolute",
  });
  assert.deepEqual(target, {
    kind: "invalid_url",
    invalidKind: "cwd",
    value: "relative",
    message: "Could not open URL working directory: path must be absolute",
  });
  assert.deepEqual(invalidUrlPayloadForTarget(target), {
    kind: "cwd",
    value: "relative",
    message: "Could not open URL working directory: path must be absolute",
  });
});

test("resolveRuntimeTarget returns invalid URL target for missing session without creating it", async () => {
  const fixture = makeFixture();
  const sessionPath = join(fixture.root, "missing.jsonl");
  const target = await resolveWithFixture(fixture, { kind: "session", sessionPath });
  assert.equal(target.kind, "invalid_url");
  assert.equal(target.invalidKind, "session");
  assert.equal(target.value, sessionPath);
  assert.match(target.message, /^Could not open URL session: path does not exist/);
  assert.equal(existsSync(sessionPath), false);
});

test("runtimeSessionManagerForTarget creates managers for valid runtime targets", () => {
  const fixture = makeFixture();
  const cwdManager = runtimeSessionManagerForTarget({
    target: { kind: "cwd", source: "url", cwd: fixture.cwd },
    sessionDir: fixture.sessionDir,
  });
  assert.equal(cwdManager.getCwd(), fixture.cwd);

  const sessionPath = join(fixture.root, "existing.jsonl");
  writeSessionFile(sessionPath, fixture.otherCwd);
  const sessionManager = runtimeSessionManagerForTarget({
    target: { kind: "session", source: "url", sessionPath, cwd: fixture.otherCwd },
    sessionDir: fixture.sessionDir,
  });
  assert.equal(sessionManager.getCwd(), fixture.otherCwd);
  assert.equal(sessionManager.getSessionFile(), sessionPath);
});

test("assertRuntimeMatchesTarget fails loudly when runtime cwd diverges", () => {
  const fixture = makeFixture();
  assert.doesNotThrow(() => assertRuntimeMatchesTarget({
    target: { kind: "cwd", source: "url", cwd: fixture.cwd },
    runtimeCwd: fixture.cwd,
  }));
  assert.throws(() => assertRuntimeMatchesTarget({
    target: { kind: "cwd", source: "url", cwd: fixture.cwd },
    runtimeCwd: fixture.otherCwd,
  }), /Runtime cwd mismatch/);
});
