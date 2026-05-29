import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseServerUrlState } from "../dist/server/url-state.js";

function makePolicyFixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-webui-url-state-"));
  const homeDir = join(root, "home");
  const project = join(homeDir, "project");
  mkdirSync(project, { recursive: true });
  return { homeDir, project, policy: { homeDir, allowAnyCwd: false } };
}

function parse(query, policy) {
  return parseServerUrlState(new URLSearchParams(query), policy);
}

test("parseServerUrlState returns new when no URL state params are present", () => {
  const { policy } = makePolicyFixture();
  assert.deepEqual(parse("debug=1", policy), { kind: "new" });
});

test("parseServerUrlState returns resolved cwd for a valid URL Cwd Pointer", () => {
  const { project, policy } = makePolicyFixture();
  assert.deepEqual(parse(`cwd=${encodeURIComponent(project)}`, policy), {
    kind: "cwd",
    cwd: project,
  });
});

test("parseServerUrlState returns cwd invalid state when cwd validation fails", () => {
  const { homeDir, policy } = makePolicyFixture();
  const state = parse("cwd=relative", policy);
  assert.equal(state.kind, "invalid");
  assert.equal(state.invalidKind, "cwd");
  assert.equal(state.value, "relative");
  assert.match(state.message, /^Could not open URL working directory: path must be absolute/);
  assert.equal(homeDir.length > 0, true);
});

test("parseServerUrlState accepts an absolute URL Session Pointer string", () => {
  const { policy } = makePolicyFixture();
  assert.deepEqual(parse("session=%2Ftmp%2Fsession.jsonl", policy), {
    kind: "session",
    sessionPath: "/tmp/session.jsonl",
  });
});

test("parseServerUrlState rejects an empty URL Session Pointer", () => {
  const { policy } = makePolicyFixture();
  const state = parse("session=", policy);
  assert.equal(state.kind, "invalid");
  assert.equal(state.invalidKind, "session");
  assert.equal(state.value, "");
  assert.match(state.message, /^Could not open URL session: path is required/);
});

test("parseServerUrlState rejects a relative URL Session Pointer", () => {
  const { policy } = makePolicyFixture();
  const state = parse("session=session.jsonl", policy);
  assert.equal(state.kind, "invalid");
  assert.equal(state.invalidKind, "session");
  assert.equal(state.value, "session.jsonl");
  assert.match(state.message, /^Could not open URL session: path must be absolute/);
});

test("parseServerUrlState rejects an empty URL Cwd Pointer", () => {
  const { policy } = makePolicyFixture();
  const state = parse("cwd=", policy);
  assert.equal(state.kind, "invalid");
  assert.equal(state.invalidKind, "cwd");
  assert.equal(state.value, "");
  assert.match(state.message, /^Could not open URL working directory: path is required/);
});

test("parseServerUrlState rejects conflicting URL Session and Cwd Pointers", () => {
  const { project, policy } = makePolicyFixture();
  const state = parse(`session=%2Ftmp%2Fs.jsonl&cwd=${encodeURIComponent(project)}`, policy);
  assert.deepEqual(state, {
    kind: "invalid",
    invalidKind: "conflict",
    value: null,
    message: "URL cannot include both session and cwd.",
  });
});
