import { test } from "node:test";
import assert from "node:assert/strict";
import { RuntimeTargetHost } from "../dist/server/runtime-target-host.js";

class FakeRuntime {
  constructor({ cwd, sessionFile = null, switchCwds = {}, switchCancelled = false, newCancelled = false }) {
    this.cwd = cwd;
    this.session = { sessionFile };
    this.switchCwds = switchCwds;
    this.switchCancelled = switchCancelled;
    this.newCancelled = newCancelled;
    this.disposed = false;
    this.switchCalls = [];
    this.newCalls = 0;
    this.beforeSessionInvalidate = null;
  }

  setBeforeSessionInvalidate(callback) {
    this.beforeSessionInvalidate = callback;
  }

  async dispose() {
    this.disposed = true;
    this.beforeSessionInvalidate?.();
  }

  async switchSession(sessionPath) {
    this.switchCalls.push(sessionPath);
    if (this.switchCancelled) return { cancelled: true };
    this.beforeSessionInvalidate?.();
    this.cwd = this.switchCwds[sessionPath] ?? this.cwd;
    this.session = { sessionFile: sessionPath };
    return { cancelled: false };
  }

  async newSession() {
    this.newCalls += 1;
    if (this.newCancelled) return { cancelled: true };
    this.beforeSessionInvalidate?.();
    this.session = { sessionFile: `${this.cwd}/new-session.jsonl` };
    return { cancelled: false };
  }
}

function createHarness(options = {}) {
  const created = [];
  const persisted = [];
  const bound = [];
  let detached = 0;
  const host = new RuntimeTargetHost({
    createRuntimeForTarget: async (target) => {
      if (options.throwCreateForCwd === target.cwd) {
        throw new Error(`failed to create runtime for ${target.cwd}`);
      }
      const runtime = new FakeRuntime({
        cwd: target.cwd,
        sessionFile: target.kind === "session" ? target.sessionPath : null,
        ...options,
      });
      created.push({ target, runtime });
      return runtime;
    },
    bindRuntime: async (runtime) => {
      bound.push(runtime.session.sessionFile);
    },
    beforeSessionInvalidate: () => {
      detached += 1;
    },
    persistLastCwd: (cwd) => {
      persisted.push(cwd);
    },
  });
  return { host, created, persisted, bound, get detached() { return detached; } };
}

test("session target transitions use runtime switchSession and commit after success", async () => {
  const cwd = "/tmp/project";
  const nextCwd = "/tmp/other";
  const sessionPath = "/tmp/session.jsonl";
  const harness = createHarness({ switchCwds: { [sessionPath]: nextCwd } });

  await harness.host.start({ kind: "cwd", cwd, source: "recovery" });
  const firstRuntime = harness.created[0].runtime;
  const result = await harness.host.applyTransition({
    kind: "session",
    sessionPath,
    cwd: nextCwd,
    source: "switch_session",
  });

  assert.deepEqual(result, {
    cancelled: false,
    target: { kind: "session", sessionPath, cwd: nextCwd, source: "recovery" },
  });
  assert.equal(harness.created.length, 1);
  assert.equal(firstRuntime.disposed, false);
  assert.deepEqual(firstRuntime.switchCalls, [sessionPath]);
  assert.deepEqual(harness.persisted, [nextCwd]);
  assert.equal(harness.detached, 1);
  assert.equal(harness.bound.length, 2);
  assert.deepEqual(harness.host.selectedTarget, result.target);
});

test("cancelled session target transitions leave target and persistence untouched", async () => {
  const cwd = "/tmp/project";
  const sessionPath = "/tmp/session.jsonl";
  const harness = createHarness({ switchCancelled: true });

  await harness.host.start({ kind: "cwd", cwd, source: "recovery" });
  const result = await harness.host.applyTransition({
    kind: "session",
    sessionPath,
    cwd: "/tmp/other",
    source: "resume",
  });

  assert.deepEqual(result, { cancelled: true });
  assert.deepEqual(harness.host.selectedTarget, { kind: "cwd", cwd, source: "recovery" });
  assert.deepEqual(harness.persisted, []);
  assert.equal(harness.detached, 0);
  assert.equal(harness.bound.length, 1);
});

test("new session target transitions use runtime newSession", async () => {
  const cwd = "/tmp/project";
  const harness = createHarness();

  await harness.host.start({ kind: "session", sessionPath: "/tmp/current.jsonl", cwd, source: "recovery" });
  const runtime = harness.created[0].runtime;
  const result = await harness.host.applyTransition({
    kind: "cwd",
    cwd,
    source: "new_session",
  });

  assert.equal(runtime.newCalls, 1);
  assert.equal(runtime.disposed, false);
  assert.deepEqual(result, {
    cancelled: false,
    target: { kind: "cwd", cwd, source: "recovery" },
  });
  assert.deepEqual(harness.persisted, [cwd]);
  assert.equal(harness.detached, 1);
});

test("cancelled new session transitions leave the selected session target untouched", async () => {
  const cwd = "/tmp/project";
  const sessionPath = "/tmp/current.jsonl";
  const harness = createHarness({ newCancelled: true });

  await harness.host.start({ kind: "session", sessionPath, cwd, source: "recovery" });
  const result = await harness.host.applyTransition({
    kind: "cwd",
    cwd,
    source: "new_session",
  });

  assert.deepEqual(result, { cancelled: true });
  assert.deepEqual(harness.host.selectedTarget, { kind: "session", sessionPath, cwd, source: "recovery" });
  assert.deepEqual(harness.persisted, []);
  assert.equal(harness.detached, 0);
});

test("cwd target transitions replace the runtime directly", async () => {
  const cwd = "/tmp/project";
  const nextCwd = "/tmp/other";
  const harness = createHarness();

  await harness.host.start({ kind: "session", sessionPath: "/tmp/current.jsonl", cwd, source: "recovery" });
  const firstRuntime = harness.created[0].runtime;
  const result = await harness.host.applyTransition({
    kind: "cwd",
    cwd: nextCwd,
    source: "slash_cwd",
  });

  assert.equal(firstRuntime.disposed, true);
  assert.equal(harness.created.length, 2);
  assert.deepEqual(result, {
    cancelled: false,
    target: { kind: "cwd", cwd: nextCwd, source: "recovery" },
  });
  assert.deepEqual(harness.persisted, [nextCwd]);
  assert.equal(harness.detached, 1);
});

test("failed runtime replacement leaves the host without a runtime", async () => {
  const cwd = "/tmp/project";
  const nextCwd = "/tmp/other";
  const harness = createHarness({ throwCreateForCwd: nextCwd });

  await harness.host.start({ kind: "session", sessionPath: "/tmp/current.jsonl", cwd, source: "recovery" });
  const firstRuntime = harness.created[0].runtime;

  await assert.rejects(() => harness.host.applyTransition({
    kind: "cwd",
    cwd: nextCwd,
    source: "slash_cwd",
  }), /failed to create runtime/);

  assert.equal(firstRuntime.disposed, true);
  assert.equal(harness.host.runtime, undefined);
  assert.equal(harness.host.selectedTarget, null);
  assert.throws(() => harness.host.requireRuntime(), /Pi runtime is not initialized/);
  assert.deepEqual(harness.persisted, []);
  assert.equal(harness.detached, 1);
  assert.equal(harness.bound.length, 1);
});

test("external session refresh commits the refreshed selected target", async () => {
  const cwd = "/tmp/project";
  const nextCwd = "/tmp/other";
  const sessionPath = "/tmp/current.jsonl";
  const harness = createHarness({ switchCwds: { [sessionPath]: nextCwd } });

  await harness.host.start({ kind: "session", sessionPath, cwd, source: "recovery" });
  const runtime = harness.created[0].runtime;
  const result = await harness.host.refreshCurrentSessionFromFile({ persistLastCwd: true });

  assert.equal(runtime.disposed, false);
  assert.deepEqual(runtime.switchCalls, [sessionPath]);
  assert.deepEqual(result, {
    cancelled: false,
    target: { kind: "session", sessionPath, cwd: nextCwd, source: "recovery" },
  });
  assert.deepEqual(harness.host.selectedTarget, result.target);
  assert.deepEqual(harness.persisted, [nextCwd]);
  assert.equal(harness.detached, 1);
  assert.equal(harness.bound.length, 2);
});

test("current runtime session adoption changes target without persisting cwd", async () => {
  const cwd = "/tmp/project";
  const harness = createHarness();

  await harness.host.start({ kind: "cwd", cwd, source: "recovery" });
  const runtime = harness.host.requireRuntime();
  runtime.session = { sessionFile: "/tmp/imported.jsonl" };
  const target = harness.host.adoptCurrentSessionTarget({ persistLastCwd: false });

  assert.deepEqual(target, {
    kind: "session",
    sessionPath: "/tmp/imported.jsonl",
    cwd,
    source: "recovery",
  });
  assert.deepEqual(harness.persisted, []);
  assert.deepEqual(harness.host.selectedTarget, target);
});

test("runtime cwd mismatch against the selected target fails loudly", async () => {
  const harness = createHarness();

  await harness.host.start({ kind: "cwd", cwd: "/tmp/project", source: "recovery" });
  harness.host.requireRuntime().cwd = "/tmp/other";

  assert.throws(() => {
    harness.host.assertCurrentRuntimeMatchesSelectedTarget();
  }, /Runtime cwd mismatch/);
});
