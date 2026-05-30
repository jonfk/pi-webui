import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listAllRecoverySessions,
  listRecentRecoveryCwds,
  listRecoveryDir,
  selectRecoveryCwd,
  selectRecoverySession,
} from "../dist/server/runtime-free-recovery.js";
import { setLastCwd } from "../dist/server/workspace-store.js";

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-webui-runtime-free-"));
  const homeDir = join(root, "home");
  const cwd = join(homeDir, "project");
  const otherCwd = join(homeDir, "other");
  const outside = join(root, "outside");
  const agentDir = join(root, "agent");
  const sessionRoot = join(agentDir, "sessions");
  const sessionBucket = join(sessionRoot, "bucket");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(join(cwd, "src"));
  mkdirSync(otherCwd, { recursive: true });
  mkdirSync(outside, { recursive: true });
  mkdirSync(sessionBucket, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return {
    root,
    homeDir,
    cwd,
    otherCwd,
    outside,
    agentDir,
    sessionBucket,
    policy: { homeDir, allowAnyCwd: false },
  };
}

function writeSessionFile(path, cwd, id = `session-${Math.random().toString(16).slice(2)}`) {
  const header = {
    type: "session",
    version: 3,
    id,
    timestamp: "2026-01-02T03:04:05.000Z",
    cwd,
  };
  const message = {
    type: "message",
    id: `msg-${id}`,
    parentId: null,
    timestamp: "2026-01-02T03:05:05.000Z",
    message: { role: "user", content: "hello" },
  };
  writeFileSync(path, `${JSON.stringify(header)}\n${JSON.stringify(message)}\n`);
}

test("listAllRecoverySessions lists sessions without a cwd", async () => {
  const fixture = makeFixture();
  const sessionPath = join(fixture.sessionBucket, "one.jsonl");
  writeSessionFile(sessionPath, fixture.cwd, "one");

  const result = await listAllRecoverySessions();
  assert.equal(result.allProjects.some((session) => session.path === sessionPath), true);
  assert.equal(result.allProjects.find((session) => session.path === sessionPath)?.cwd, fixture.cwd);
});

test("listRecentRecoveryCwds derives recents from all sessions and valid lastCwd", async () => {
  const fixture = makeFixture();
  writeSessionFile(join(fixture.sessionBucket, "one.jsonl"), fixture.cwd, "one");
  writeSessionFile(join(fixture.sessionBucket, "two.jsonl"), fixture.cwd, "two");
  setLastCwd(fixture.agentDir, fixture.otherCwd);

  const result = await listRecentRecoveryCwds({
    agentDir: fixture.agentDir,
    policy: fixture.policy,
  });

  assert.equal(result.some((entry) => entry.cwd === fixture.cwd && entry.count === 2), true);
  assert.equal(result.some((entry) => entry.cwd === fixture.otherCwd), true);
});

test("listRecentRecoveryCwds omits session cwd values outside policy", async () => {
  const fixture = makeFixture();
  const outsideSessionPath = join(fixture.sessionBucket, "outside.jsonl");
  writeSessionFile(outsideSessionPath, fixture.outside, "outside");
  writeSessionFile(join(fixture.sessionBucket, "valid.jsonl"), fixture.cwd, "valid");

  const result = await listRecentRecoveryCwds({
    agentDir: fixture.agentDir,
    policy: fixture.policy,
  });

  assert.equal(result.some((entry) => entry.cwd === fixture.outside), false);
  assert.equal(result.some((entry) => entry.cwd === fixture.cwd && entry.count === 1), true);

  const sessions = await listAllRecoverySessions();
  assert.equal(sessions.allProjects.some((session) => session.path === outsideSessionPath), true);
});

test("listRecentRecoveryCwds omits session cwd values that no longer exist", async () => {
  const fixture = makeFixture();
  const deletedCwd = join(fixture.homeDir, "deleted");
  mkdirSync(deletedCwd, { recursive: true });
  writeSessionFile(join(fixture.sessionBucket, "deleted.jsonl"), deletedCwd, "deleted");
  writeSessionFile(join(fixture.sessionBucket, "valid.jsonl"), fixture.cwd, "valid");
  rmSync(deletedCwd, { recursive: true });

  const result = await listRecentRecoveryCwds({
    agentDir: fixture.agentDir,
    policy: fixture.policy,
  });

  assert.equal(result.some((entry) => entry.cwd === deletedCwd), false);
  assert.equal(result.some((entry) => entry.cwd === fixture.cwd && entry.count === 1), true);
});

test("listRecentRecoveryCwds omits invalid lastCwd values", async () => {
  const fixture = makeFixture();
  writeSessionFile(join(fixture.sessionBucket, "valid.jsonl"), fixture.cwd, "valid");
  setLastCwd(fixture.agentDir, fixture.outside);

  const result = await listRecentRecoveryCwds({
    agentDir: fixture.agentDir,
    policy: fixture.policy,
  });

  assert.equal(result.some((entry) => entry.cwd === fixture.outside), false);
  assert.equal(result.some((entry) => entry.cwd === fixture.cwd && entry.count === 1), true);
});

test("listRecoveryDir validates paths with cwd policy", () => {
  const fixture = makeFixture();
  assert.deepEqual(listRecoveryDir({ path: fixture.cwd, policy: fixture.policy }).entries.map((e) => e.name), ["src"]);
  assert.throws(
    () => listRecoveryDir({ path: fixture.outside, policy: fixture.policy }),
    /path must be inside/,
  );
});

test("selectRecoveryCwd validates cwd and returns a cwd target", () => {
  const fixture = makeFixture();
  assert.deepEqual(selectRecoveryCwd({ cwd: fixture.cwd, policy: fixture.policy }), {
    ok: true,
    target: { kind: "cwd", source: "recovery", cwd: fixture.cwd },
  });

  const invalid = selectRecoveryCwd({ cwd: fixture.outside, policy: fixture.policy });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /path must be inside/);
});

test("selectRecoverySession validates session and returns header cwd target", () => {
  const fixture = makeFixture();
  const sessionPath = join(fixture.sessionBucket, "one.jsonl");
  writeSessionFile(sessionPath, fixture.otherCwd, "one");

  assert.deepEqual(selectRecoverySession({
    sessionPath,
    policy: fixture.policy,
  }), {
    ok: true,
    target: {
      kind: "session",
      source: "recovery",
      sessionPath,
      cwd: fixture.otherCwd,
    },
  });
});

test("selectRecoverySession rejects missing files and invalid header cwds", () => {
  const fixture = makeFixture();
  const missing = selectRecoverySession({
    sessionPath: join(fixture.sessionBucket, "missing.jsonl"),
    policy: fixture.policy,
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /path does not exist/);

  const sessionPath = join(fixture.sessionBucket, "outside.jsonl");
  writeSessionFile(sessionPath, fixture.outside, "outside");
  const invalidCwd = selectRecoverySession({ sessionPath, policy: fixture.policy });
  assert.equal(invalidCwd.ok, false);
  assert.match(invalidCwd.error, /path must be inside/);
});
