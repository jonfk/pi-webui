import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  expandTildePath,
  isCwdReachable,
  listDirectories,
  validateCwdTarget,
} from "../dist/server/cwd.js";

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-webui-cwd-"));
  const homeDir = join(root, "home");
  const project = join(homeDir, "project");
  const outside = join(root, "outside");
  mkdirSync(project, { recursive: true });
  mkdirSync(join(project, "src"));
  mkdirSync(join(project, ".hidden"));
  mkdirSync(outside);
  writeFileSync(join(homeDir, "file.txt"), "not a directory");
  return { root, homeDir, project, outside };
}

test("validateCwdTarget accepts an existing directory inside home", () => {
  const { homeDir, project } = makeFixture();
  assert.equal(validateCwdTarget(project, { homeDir, allowAnyCwd: false }), project);
});

test("validateCwdTarget requires a path", () => {
  const { homeDir } = makeFixture();
  assert.throws(
    () => validateCwdTarget("", { homeDir, allowAnyCwd: false }),
    /path is required/,
  );
});

test("validateCwdTarget rejects files", () => {
  const { homeDir } = makeFixture();
  assert.throws(
    () => validateCwdTarget(join(homeDir, "file.txt"), { homeDir, allowAnyCwd: false }),
    /not a directory/,
  );
});

test("validateCwdTarget rejects relative paths", () => {
  const { homeDir } = makeFixture();
  assert.throws(
    () => validateCwdTarget("project", { homeDir, allowAnyCwd: false }),
    /path must be absolute/,
  );
});

test("validateCwdTarget rejects paths outside home unless allowAnyCwd is enabled", () => {
  const { homeDir, outside } = makeFixture();
  assert.throws(
    () => validateCwdTarget(outside, { homeDir, allowAnyCwd: false }),
    /path must be inside/,
  );
  assert.equal(validateCwdTarget(outside, { homeDir, allowAnyCwd: true }), outside);
});

test("expandTildePath expands home-relative paths", () => {
  const { homeDir } = makeFixture();
  assert.equal(expandTildePath("~", { homeDir, allowAnyCwd: false }), homeDir);
  assert.equal(
    expandTildePath("~/project", { homeDir, allowAnyCwd: false }),
    resolve(homeDir, "project"),
  );
});

test("isCwdReachable allows home ancestors so the picker can navigate toward home", () => {
  const { root, homeDir, outside } = makeFixture();
  const policy = { homeDir, allowAnyCwd: false };
  assert.equal(isCwdReachable(root, policy), true);
  assert.equal(isCwdReachable(homeDir, policy), true);
  assert.equal(isCwdReachable(outside, policy), false);
});

test("listDirectories lists visible child directories sorted by name", () => {
  const { homeDir, project } = makeFixture();
  mkdirSync(join(project, "app"));
  const result = listDirectories(project, { homeDir, allowAnyCwd: false });
  assert.deepEqual(result.entries.map((entry) => entry.name), ["app", "src"]);
  assert.deepEqual(result.entries.map((entry) => entry.path), [
    join(project, "app"),
    join(project, "src"),
  ]);
});
