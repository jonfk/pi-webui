import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appRouter } from "../dist/server/sidebar-router.js";
import { WorkspaceIndexService } from "../dist/server/workspace-index.js";
import { addWorkspace } from "../dist/server/workspace-store.js";

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

test("sidebar tRPC router exposes workspace index and validates page input", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-webui-router-"));
  try {
    addWorkspace(agentDir, "/work/project", "project");
    const workspaceIndex = new WorkspaceIndexService({
      agentDir,
      listSessions: async () => Array.from({ length: 6 }, (_, index) => session(`s${index}`, "/work/project", index)),
    });
    const caller = appRouter.createCaller({ workspaceIndex });

    const index = await caller.sidebar.workspaceIndex();
    assert.equal(index.workspaces[0].path, "/work/project");

    const page = await caller.sidebar.workspaceSessions({
      workspacePath: "/work/project",
      cursor: index.workspaces[0].sessionsWindow.nextCursor,
      limit: 10,
    });
    assert.deepEqual(page.sessions.map((entry) => entry.id), ["s0"]);

    await assert.rejects(
      caller.sidebar.workspaceSessions({ workspacePath: "/work/project", limit: 10 }),
      /Invalid input/,
    );
    await assert.rejects(
      caller.sidebar.workspaceSessions({
        workspacePath: "/work/project",
        cursor: index.workspaces[0].sessionsWindow.nextCursor,
        limit: 5,
      }),
      /Invalid input/,
    );
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});
