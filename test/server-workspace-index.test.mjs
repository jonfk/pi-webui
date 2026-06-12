import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addWorkspace } from "../dist/server/workspace-store.js";
import {
  WORKSPACE_SESSIONS_PAGE_LIMIT,
  WORKSPACE_SESSIONS_WINDOW_LIMIT,
  WorkspaceIndexService,
} from "../dist/server/workspace-index.js";

function tempAgentDir() {
  return mkdtempSync(join(tmpdir(), "pi-webui-index-"));
}

function session(id, cwd, modifiedOffset) {
  const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, modifiedOffset)).toISOString();
  return {
    path: `/sessions/${id}.jsonl`,
    id,
    cwd,
    created: new Date(timestamp),
    modified: new Date(timestamp),
    messageCount: modifiedOffset,
    firstMessage: `first ${id}`,
    allMessagesText: `all ${id}`,
  };
}

function makeService(agentDir, sessions) {
  return new WorkspaceIndexService({
    agentDir,
    listSessions: async () => sessions,
  });
}

test("workspace index groups only saved workspaces with exact cwd matches", async () => {
  const agentDir = tempAgentDir();
  try {
    addWorkspace(agentDir, "/work/project", "project");
    addWorkspace(agentDir, "/work/empty", "empty");
    const sessions = [
      session("exact-new", "/work/project", 3),
      session("prefix-child", "/work/project/subdir", 4),
      session("prefix-share", "/work/project-other", 5),
      session("unsaved", "/work/other", 6),
      session("exact-old", "/work/project", 1),
    ];

    const index = await makeService(agentDir, sessions).workspaceIndex();

    assert.deepEqual(index.workspaces.map((workspace) => workspace.path), [
      "/work/empty",
      "/work/project",
    ]);
    assert.equal(index.workspaces[0].sessionCount, 0);
    assert.deepEqual(
      index.workspaces[1].sessionsWindow.sessions.map((entry) => entry.id),
      ["exact-new", "exact-old"],
    );
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("workspace index caps initial windows at five sessions sorted by modified desc", async () => {
  const agentDir = tempAgentDir();
  try {
    addWorkspace(agentDir, "/work/project", "project");
    const sessions = Array.from({ length: 8 }, (_, index) => session(`s${index}`, "/work/project", index));

    const workspace = (await makeService(agentDir, sessions).workspaceIndex()).workspaces[0];

    assert.equal(workspace.sessionCount, 8);
    assert.equal(workspace.sessionsWindow.limit, WORKSPACE_SESSIONS_WINDOW_LIMIT);
    assert.deepEqual(
      workspace.sessionsWindow.sessions.map((entry) => entry.id),
      ["s7", "s6", "s5", "s4", "s3"],
    );
    assert.equal(workspace.sessionsWindow.hasMore, true);
    assert.equal(typeof workspace.sessionsWindow.nextCursor, "string");
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("workspace sessions page returns ten additional sessions", async () => {
  const agentDir = tempAgentDir();
  try {
    addWorkspace(agentDir, "/work/project", "project");
    const sessions = Array.from({ length: 17 }, (_, index) => session(`s${index}`, "/work/project", index));
    const service = makeService(agentDir, sessions);
    const workspace = (await service.workspaceIndex()).workspaces[0];

    const page = await service.workspaceSessions({
      workspacePath: "/work/project",
      cursor: workspace.sessionsWindow.nextCursor,
      limit: WORKSPACE_SESSIONS_PAGE_LIMIT,
    });

    assert.deepEqual(
      page.sessions.map((entry) => entry.id),
      ["s11", "s10", "s9", "s8", "s7", "s6", "s5", "s4", "s3", "s2"],
    );
    assert.equal(page.hasMore, true);
    assert.equal(typeof page.nextCursor, "string");

    const lastPage = await service.workspaceSessions({
      workspacePath: "/work/project",
      cursor: page.nextCursor,
      limit: WORKSPACE_SESSIONS_PAGE_LIMIT,
    });
    assert.deepEqual(lastPage.sessions.map((entry) => entry.id), ["s1", "s0"]);
    assert.equal(lastPage.hasMore, false);
    assert.equal(lastPage.nextCursor, null);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("workspace sessions reject malformed cursors unknown workspaces and unsupported limits", async () => {
  const agentDir = tempAgentDir();
  try {
    addWorkspace(agentDir, "/work/project", "project");
    const service = makeService(agentDir, [session("s1", "/work/project", 1)]);

    await assert.rejects(
      service.workspaceSessions({ workspacePath: "/work/project", limit: 10 }),
      /invalid workspace sessions cursor/,
    );
    await assert.rejects(
      service.workspaceSessions({ workspacePath: "/work/project", cursor: "not-json", limit: 10 }),
      /invalid workspace sessions cursor/,
    );
    await assert.rejects(
      service.workspaceSessions({ workspacePath: "/work/missing", limit: 10 }),
      /workspace not found/,
    );
    await assert.rejects(
      service.workspaceSessions({ workspacePath: "/work/project", limit: 5 }),
      /workspaceSessions limit must be 10/,
    );
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("workspace sessions reject stale cursors when the matching session list changes", async () => {
  const agentDir = tempAgentDir();
  try {
    addWorkspace(agentDir, "/work/project", "project");
    const sessions = Array.from({ length: 7 }, (_, index) => session(`s${index}`, "/work/project", index));
    const service = makeService(agentDir, sessions);
    const workspace = (await service.workspaceIndex()).workspaces[0];

    sessions.unshift(session("newest", "/work/project", 99));
    await assert.rejects(
      service.workspaceSessions({
        workspacePath: "/work/project",
        cursor: workspace.sessionsWindow.nextCursor,
        limit: 10,
      }),
      /stale workspace sessions cursor/,
    );
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("workspace sessions reject cursors issued for another workspace", async () => {
  const agentDir = tempAgentDir();
  try {
    addWorkspace(agentDir, "/work/alpha", "alpha");
    addWorkspace(agentDir, "/work/beta", "beta");
    const sessions = [
      ...Array.from({ length: 6 }, (_, index) => session(`a${index}`, "/work/alpha", index)),
      ...Array.from({ length: 6 }, (_, index) => session(`b${index}`, "/work/beta", index)),
    ];
    const service = makeService(agentDir, sessions);
    const alpha = (await service.workspaceIndex()).workspaces.find((entry) => entry.path === "/work/alpha");

    await assert.rejects(
      service.workspaceSessions({
        workspacePath: "/work/beta",
        cursor: alpha.sessionsWindow.nextCursor,
        limit: 10,
      }),
      /workspace sessions cursor does not match workspace/,
    );
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});
