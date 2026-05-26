import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  addWorkspace,
  findWorkspace,
  loadWorkspaceRegistry,
  removeWorkspace,
  setActiveWorkspace,
} from "../dist/server/workspace-store.js";

function tempAgentDir() {
  return mkdtempSync(join(tmpdir(), "pi-webui-agent-"));
}

test("workspace registry starts empty and persists added workspaces", () => {
  const agentDir = tempAgentDir();
  try {
    assert.deepEqual(loadWorkspaceRegistry(agentDir), { version: 1, workspaces: [] });

    const workspace = addWorkspace(agentDir, "/tmp/project-a", "project-a");
    assert.equal(workspace.name, "project-a");
    assert.equal(workspace.path, "/tmp/project-a");

    const registry = loadWorkspaceRegistry(agentDir);
    assert.equal(registry.workspaces.length, 1);
    assert.equal(findWorkspace(registry, "project-a")?.path, "/tmp/project-a");
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("workspace registry rejects duplicate names and paths", () => {
  const agentDir = tempAgentDir();
  try {
    addWorkspace(agentDir, "/tmp/project-a", "project-a");
    assert.throws(() => addWorkspace(agentDir, "/tmp/project-b", "project-a"), /workspace already exists/);
    assert.throws(() => addWorkspace(agentDir, "/tmp/project-a", "other"), /workspace path already exists/);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("active workspace is persisted and cleared when removed", () => {
  const agentDir = tempAgentDir();
  try {
    addWorkspace(agentDir, "/tmp/project-a", "project-a");
    setActiveWorkspace(agentDir, "/tmp/project-a");
    assert.equal(loadWorkspaceRegistry(agentDir).activePath, "/tmp/project-a");

    const removed = removeWorkspace(agentDir, "project-a");
    assert.equal(removed.path, "/tmp/project-a");
    assert.equal(loadWorkspaceRegistry(agentDir).activePath, undefined);

    const raw = JSON.parse(readFileSync(join(agentDir, "workspaces.json"), "utf8"));
    assert.deepEqual(raw.workspaces, []);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});
