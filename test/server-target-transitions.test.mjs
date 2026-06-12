import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TargetTransitionApplicator,
  resolveCwdTransition,
  resolveNewSessionTransition,
  resolveOpenCwdTransition,
  resolveSessionTransition,
  resolveWorkspaceTransition,
  shouldPersistLastCwd,
  transitionFromStartupTarget,
  transitionToRuntimeTarget,
} from "../dist/server/target-transitions.js";
import { addWorkspace } from "../dist/server/workspace-store.js";

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-webui-target-transition-"));
  const homeDir = join(root, "home");
  const cwd = join(homeDir, "project");
  const otherCwd = join(homeDir, "other");
  const outside = join(root, "outside");
  const agentDir = join(root, "agent");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(otherCwd, { recursive: true });
  mkdirSync(outside, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return {
    root,
    homeDir,
    cwd,
    otherCwd,
    outside,
    agentDir,
    policy: { homeDir, allowAnyCwd: false },
  };
}

function writeSessionFile(path, cwd, header = {}) {
  const sessionHeader = {
    type: "session",
    version: 3,
    id: `session-${Math.random().toString(16).slice(2)}`,
    timestamp: "2026-01-02T03:04:05.000Z",
    cwd,
    ...header,
  };
  writeFileSync(path, `${JSON.stringify(sessionHeader)}\n`);
}

test("valid URL cwd startup becomes a persistent explicit transition", () => {
  const fixture = makeFixture();
  const transition = transitionFromStartupTarget({
    kind: "cwd",
    source: "url",
    cwd: fixture.cwd,
  });

  assert.deepEqual(transition, {
    kind: "cwd",
    source: "url_cwd_startup",
    cwd: fixture.cwd,
  });
  assert.equal(shouldPersistLastCwd(transition), true);
});

test("plain startup from lastCwd is not a new persistence transition", () => {
  const fixture = makeFixture();
  assert.equal(transitionFromStartupTarget({
    kind: "cwd",
    source: "lastCwd",
    cwd: fixture.cwd,
  }), null);
});

test("invalid URL state and cwd-required state do not produce transitions", () => {
  assert.equal(transitionFromStartupTarget({
    kind: "invalid_url",
    invalidKind: "cwd",
    value: "relative",
    message: "bad cwd",
  }), null);
  assert.equal(transitionFromStartupTarget({
    kind: "cwd_required",
    message: "choose cwd",
  }), null);
});

test("cwd and workspace transitions resolve validated cwd targets", () => {
  const fixture = makeFixture();
  assert.deepEqual(resolveCwdTransition({
    cwd: fixture.cwd,
    policy: fixture.policy,
    source: "slash_cwd",
  }), {
    kind: "cwd",
    source: "slash_cwd",
    cwd: fixture.cwd,
  });

  addWorkspace(fixture.agentDir, fixture.otherCwd, "other");
  const workspaceTransition = resolveWorkspaceTransition({
    selector: "other",
    agentDir: fixture.agentDir,
    policy: fixture.policy,
  });
  assert.equal(workspaceTransition.kind, "cwd");
  assert.equal(workspaceTransition.source, "workspace");
  assert.equal(workspaceTransition.cwd, fixture.otherCwd);
  assert.equal(workspaceTransition.workspace.name, "other");

  assert.throws(() => resolveCwdTransition({
    cwd: fixture.outside,
    policy: fixture.policy,
    source: "slash_cwd",
  }), /path must be inside/);
});

test("new session transition with omitted cwd uses the selected runtime target cwd", () => {
  const fixture = makeFixture();

  assert.deepEqual(resolveNewSessionTransition({
    selectedTarget: {
      kind: "session",
      sessionPath: join(fixture.root, "current.jsonl"),
      cwd: fixture.cwd,
      source: "recovery",
    },
    policy: fixture.policy,
  }), {
    kind: "cwd",
    source: "new_session",
    cwd: fixture.cwd,
  });
});

test("open cwd transition validates and uses explicit cwd", () => {
  const fixture = makeFixture();

  assert.deepEqual(resolveOpenCwdTransition({
    cwd: fixture.otherCwd,
    policy: fixture.policy,
  }), {
    kind: "cwd",
    source: "open_cwd",
    cwd: fixture.otherCwd,
  });
});

test("open cwd transition rejects malformed or invalid explicit cwd", () => {
  const fixture = makeFixture();

  assert.throws(() => resolveOpenCwdTransition({
    cwd: null,
    policy: fixture.policy,
  }), /cwd must be a string/);

  assert.throws(() => resolveOpenCwdTransition({
    cwd: fixture.outside,
    policy: fixture.policy,
  }), /path must be inside/);
});

test("new session transition without cwd still requires a selected runtime target", () => {
  const fixture = makeFixture();

  assert.throws(() => resolveNewSessionTransition({
    selectedTarget: null,
    policy: fixture.policy,
  }), /No selected runtime target/);
});

test("session transition resolves header cwd and rejects bad sessions before runtime switch", () => {
  const fixture = makeFixture();
  const sessionPath = join(fixture.root, "session.jsonl");
  writeSessionFile(sessionPath, fixture.otherCwd);

  assert.deepEqual(resolveSessionTransition({
    sessionPath,
    policy: fixture.policy,
    source: "picker",
  }), {
    kind: "session",
    source: "picker",
    sessionPath,
    cwd: fixture.otherCwd,
  });
  assert.equal(shouldPersistLastCwd(resolveSessionTransition({
    sessionPath,
    policy: fixture.policy,
    source: "import",
  })), false);

  assert.throws(() => resolveSessionTransition({
    sessionPath: join(fixture.root, "missing.jsonl"),
    policy: fixture.policy,
    source: "switch_session",
  }), /path does not exist/);

  const outsideSession = join(fixture.root, "outside.jsonl");
  writeSessionFile(outsideSession, fixture.outside);
  assert.throws(() => resolveSessionTransition({
    sessionPath: outsideSession,
    policy: fixture.policy,
    source: "switch_session",
  }), /path must be inside/);
});

test("transitionToRuntimeTarget preserves transition cwd as runtime authority", () => {
  const fixture = makeFixture();
  assert.deepEqual(transitionToRuntimeTarget({
    kind: "cwd",
    source: "open_cwd",
    cwd: fixture.cwd,
  }), {
    kind: "cwd",
    source: "recovery",
    cwd: fixture.cwd,
  });

  assert.deepEqual(transitionToRuntimeTarget({
    kind: "session",
    source: "switch_session",
    sessionPath: "/tmp/s.jsonl",
    cwd: fixture.otherCwd,
  }), {
    kind: "session",
    source: "recovery",
    sessionPath: "/tmp/s.jsonl",
    cwd: fixture.otherCwd,
  });
});

test("target transition applicator rejects concurrent runtime-creating transitions", async () => {
  const fixture = makeFixture();
  const applicator = new TargetTransitionApplicator();
  let release;
  const first = applicator.apply({
    kind: "cwd",
    source: "picker",
    cwd: fixture.cwd,
  }, async () => {
    await new Promise((resolve) => { release = resolve; });
    return "first";
  });

  await assert.rejects(
    applicator.apply({
      kind: "cwd",
      source: "picker",
      cwd: fixture.otherCwd,
    }, async () => "second"),
    /already in progress/,
  );

  release();
  assert.equal(await first, "first");
  assert.equal(await applicator.apply({
    kind: "cwd",
    source: "picker",
    cwd: fixture.otherCwd,
  }, async () => "after"), "after");
});
