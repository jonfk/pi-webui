import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSessionPointer } from "../dist/server/url-session-startup.js";

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-webui-url-startup-"));
  const homeDir = join(root, "home");
  const cwd = join(homeDir, "project");
  mkdirSync(cwd, { recursive: true });
  return { root, homeDir, cwd };
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

test("validateSessionPointer accepts a session file with a header cwd", () => {
  const fixture = makeFixture();
  const sessionPath = join(fixture.root, "existing.jsonl");
  writeSessionFile(sessionPath, fixture.cwd);
  assert.deepEqual(validateSessionPointer(sessionPath), { ok: true });
});

test("validateSessionPointer rejects a missing URL Session Pointer without creating it", () => {
  const fixture = makeFixture();
  const sessionPath = join(fixture.root, "missing.jsonl");
  const result = validateSessionPointer(sessionPath);
  assert.equal(result.ok, false);
  assert.match(result.reason, /^path does not exist/);
  assert.equal(existsSync(sessionPath), false);
});

test("validateSessionPointer rejects empty, corrupt, headerless, and missing-cwd files without changing them", () => {
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
    const result = validateSessionPointer(sessionPath);
    assert.equal(result.ok, false, fileName);
    assert.equal(readFileSync(sessionPath, "utf8"), contents, fileName);
  }
});
