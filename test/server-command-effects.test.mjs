import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commandSuccessPayload,
  runtimeTargetChangedEffect,
  withCommandEffects,
} from "../dist/server/command-effects.js";

test("runtime target changed effects serialize cwd targets without runtime-only fields", () => {
  assert.deepEqual(runtimeTargetChangedEffect({
    kind: "cwd",
    cwd: "/work/project",
    source: "recovery",
  }), {
    type: "runtime_target_changed",
    target: {
      kind: "cwd",
      cwd: "/work/project",
    },
  });
});

test("runtime target changed effects serialize session targets without runtime-only fields", () => {
  assert.deepEqual(runtimeTargetChangedEffect({
    kind: "session",
    sessionPath: "/tmp/session.jsonl",
    cwd: "/work/project",
    source: "recovery",
  }), {
    type: "runtime_target_changed",
    target: {
      kind: "session",
      sessionPath: "/tmp/session.jsonl",
      cwd: "/work/project",
    },
  });
});

test("successful command payloads add effects beside existing data", () => {
  const data = { sessionPath: "/tmp/session.jsonl", cwd: "/work/project" };
  const effect = runtimeTargetChangedEffect({
    kind: "session",
    sessionPath: data.sessionPath,
    cwd: data.cwd,
  });

  assert.deepEqual(commandSuccessPayload(
    "switch_session",
    withCommandEffects(data, [effect]),
  ), {
    command: "switch_session",
    ok: true,
    data,
    effects: [effect],
  });
});

test("successful command payloads omit effects for ordinary and cancelled results", () => {
  assert.deepEqual(commandSuccessPayload("refresh", { refreshed: true }), {
    command: "refresh",
    ok: true,
    data: { refreshed: true },
  });
  assert.deepEqual(commandSuccessPayload("new_session", { cancelled: true }), {
    command: "new_session",
    ok: true,
    data: { cancelled: true },
  });
});
