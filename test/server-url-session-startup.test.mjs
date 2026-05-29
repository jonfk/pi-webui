import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInitialUrlSession } from "../dist/server/url-session-startup.js";

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-webui-url-startup-"));
  const homeDir = join(root, "home");
  const defaultCwd = join(homeDir, "default");
  const otherCwd = join(homeDir, "other");
  const sessionDir = join(root, "sessions");
  mkdirSync(defaultCwd, { recursive: true });
  mkdirSync(otherCwd, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  return {
    root,
    homeDir,
    defaultCwd,
    otherCwd,
    sessionDir,
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

async function resolveWithFixture(fixture, urlState) {
  return resolveInitialUrlSession({
    urlState,
    defaultCwd: fixture.defaultCwd,
    sessionDir: fixture.sessionDir,
    policy: fixture.policy,
  });
}

test("resolveInitialUrlSession creates a new session in cwd mode for new URL state", async () => {
  const fixture = makeFixture();
  const result = await resolveWithFixture(fixture, { kind: "new" });
  assert.equal(result.kind, "valid");
  assert.equal(result.source, "new");
  assert.equal(result.cwd, fixture.defaultCwd);
  assert.equal(result.sessionManager.getCwd(), fixture.defaultCwd);
});

test("resolveInitialUrlSession creates a fresh manager for a URL Cwd Pointer", async () => {
  const fixture = makeFixture();
  const result = await resolveWithFixture(fixture, { kind: "cwd", cwd: fixture.otherCwd });
  assert.equal(result.kind, "valid");
  assert.equal(result.source, "cwd");
  assert.equal(result.cwd, fixture.otherCwd);
  assert.equal(result.sessionManager.getHeader()?.cwd, fixture.otherCwd);
});

test("resolveInitialUrlSession opens a valid URL Session Pointer using the session header cwd", async () => {
  const fixture = makeFixture();
  const sessionPath = join(fixture.root, "existing.jsonl");
  writeSessionFile(sessionPath, fixture.otherCwd);
  const result = await resolveWithFixture(fixture, { kind: "session", sessionPath });
  assert.equal(result.kind, "valid");
  assert.equal(result.source, "session");
  assert.equal(result.cwd, fixture.otherCwd);
  assert.equal(result.sessionManager.getCwd(), fixture.otherCwd);
  assert.equal(result.sessionManager.getSessionFile(), sessionPath);
});

test("resolveInitialUrlSession rejects a missing URL Session Pointer without creating it", async () => {
  const fixture = makeFixture();
  const sessionPath = join(fixture.root, "missing.jsonl");
  const result = await resolveWithFixture(fixture, { kind: "session", sessionPath });
  assert.equal(result.kind, "invalid");
  assert.equal(result.payload.kind, "session");
  assert.equal(result.payload.value, sessionPath);
  assert.match(result.payload.message, /^Could not open URL session: path does not exist/);
  assert.equal(existsSync(sessionPath), false);
});

test("resolveInitialUrlSession rejects empty, corrupt, headerless, and missing-cwd files without changing them", async () => {
  const fixture = makeFixture();
  const cases = [
    ["empty.jsonl", ""],
    ["corrupt.jsonl", "{not-json}\n"],
    ["headerless.jsonl", JSON.stringify({ type: "message", id: "m1" }) + "\n"],
    ["missing-cwd.jsonl", JSON.stringify({
      type: "session",
      version: 3,
      id: "no-cwd",
      timestamp: "2026-01-02T03:04:05.000Z",
    }) + "\n"],
  ];

  for (const [fileName, contents] of cases) {
    const sessionPath = join(fixture.root, fileName);
    writeFileSync(sessionPath, contents);
    const result = await resolveWithFixture(fixture, { kind: "session", sessionPath });
    assert.equal(result.kind, "invalid", fileName);
    assert.equal(result.payload.kind, "session", fileName);
    assert.equal(readFileSync(sessionPath, "utf8"), contents, fileName);
  }
});

test("resolveInitialUrlSession rejects a session whose stored cwd no longer passes cwd policy", async () => {
  const fixture = makeFixture();
  const missingCwd = join(fixture.homeDir, "deleted");
  const sessionPath = join(fixture.root, "deleted-cwd.jsonl");
  writeSessionFile(sessionPath, missingCwd);
  const result = await resolveWithFixture(fixture, { kind: "session", sessionPath });
  assert.equal(result.kind, "invalid");
  assert.equal(result.payload.kind, "session_cwd");
  assert.equal(result.payload.value, missingCwd);
  assert.match(result.payload.message, /^Could not open URL session working directory: path does not exist/);
});

test("resolveInitialUrlSession turns parsed invalid URL state into invalid payload with default-cwd sessions", async () => {
  const fixture = makeFixture();
  const existing = join(fixture.sessionDir, "listed.jsonl");
  writeSessionFile(existing, fixture.defaultCwd);
  const result = await resolveWithFixture(fixture, {
    kind: "invalid",
    invalidKind: "cwd",
    value: "relative",
    message: "Could not open URL working directory: path must be absolute",
  });
  assert.equal(result.kind, "invalid");
  assert.equal(result.payload.kind, "cwd");
  assert.equal(result.payload.defaultCwd, fixture.defaultCwd);
  assert.deepEqual(result.payload.sessions.currentProject.map((session) => session.path), [existing]);
  assert.equal(Array.isArray(result.payload.sessions.allProjects), true);
});
