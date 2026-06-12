import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { serializeSessionInfo, type SerializedSessionInfo } from "./session-info.js";
import { loadWorkspaceRegistry, type StoredWorkspace } from "./workspace-store.js";

export const WORKSPACE_SESSIONS_WINDOW_LIMIT = 5;
export const WORKSPACE_SESSIONS_PAGE_LIMIT = 10;

export type WorkspaceSessionsWindow = {
  limit: typeof WORKSPACE_SESSIONS_WINDOW_LIMIT;
  sessions: SerializedSessionInfo[];
  nextCursor: string | null;
  hasMore: boolean;
  listVersion: string;
};

export type WorkspaceIndexEntry = StoredWorkspace & {
  sessionCount: number;
  sessionsWindow: WorkspaceSessionsWindow;
};

export type WorkspaceIndex = {
  workspaces: WorkspaceIndexEntry[];
};

export type WorkspaceSessionsPage = {
  workspacePath: string;
  listVersion: string;
  sessions: SerializedSessionInfo[];
  nextCursor: string | null;
  hasMore: boolean;
};

type SessionLister = () => Promise<SessionInfo[]>;

type CursorPayload = {
  workspacePath: string;
  listVersion: string;
  offset: number;
};

type IndexedSession = {
  info: SessionInfo;
  serialized: SerializedSessionInfo;
};

export class WorkspaceIndexService {
  readonly #agentDir: string;
  readonly #listSessions: SessionLister;

  constructor(options: { agentDir: string; listSessions?: SessionLister }) {
    this.#agentDir = options.agentDir;
    this.#listSessions = options.listSessions ?? (() => SessionManager.listAll());
  }

  async workspaceIndex(): Promise<WorkspaceIndex> {
    const registry = loadWorkspaceRegistry(this.#agentDir);
    const sessions = await this.#sortedSessions();
    return {
      workspaces: sortWorkspaces(registry.workspaces).map((workspace) => {
        const matching = sessions.filter((session) => session.info.cwd === workspace.path);
        return this.#workspaceEntry(workspace, matching);
      }),
    };
  }

  async workspaceSessions(args: {
    workspacePath: string;
    cursor: string;
    limit: number;
  }): Promise<WorkspaceSessionsPage> {
    if (args.limit !== WORKSPACE_SESSIONS_PAGE_LIMIT) {
      throw new Error(`workspaceSessions limit must be ${WORKSPACE_SESSIONS_PAGE_LIMIT}`);
    }

    const registry = loadWorkspaceRegistry(this.#agentDir);
    const workspace = registry.workspaces.find((entry) => entry.path === args.workspacePath);
    if (!workspace) throw new Error(`workspace not found: ${args.workspacePath}`);

    const sessions = (await this.#sortedSessions()).filter((session) => session.info.cwd === workspace.path);
    const listVersion = sessionListVersion(sessions);
    const cursor = decodeCursor(args.cursor);
    if (cursor.workspacePath !== workspace.path) {
      throw new Error("workspace sessions cursor does not match workspace");
    }
    if (cursor.listVersion !== listVersion) {
      throw new Error("stale workspace sessions cursor");
    }
    const offset = cursor.offset;
    const page = sessions.slice(offset, offset + args.limit);
    const nextOffset = offset + page.length;

    return {
      workspacePath: workspace.path,
      listVersion,
      sessions: page.map((session) => session.serialized),
      nextCursor: nextOffset < sessions.length
        ? encodeCursor({ workspacePath: workspace.path, listVersion, offset: nextOffset })
        : null,
      hasMore: nextOffset < sessions.length,
    };
  }

  async #sortedSessions(): Promise<IndexedSession[]> {
    return (await this.#listSessions()).map(toIndexedSession).sort(compareSessions);
  }

  #workspaceEntry(workspace: StoredWorkspace, sessions: IndexedSession[]): WorkspaceIndexEntry {
    const window = sessions.slice(0, WORKSPACE_SESSIONS_WINDOW_LIMIT);
    const listVersion = sessionListVersion(sessions);
    return {
      ...workspace,
      sessionCount: sessions.length,
      sessionsWindow: {
        limit: WORKSPACE_SESSIONS_WINDOW_LIMIT,
        sessions: window.map((session) => session.serialized),
        nextCursor: sessions.length > window.length
          ? encodeCursor({ workspacePath: workspace.path, listVersion, offset: window.length })
          : null,
        hasMore: sessions.length > window.length,
        listVersion,
      },
    };
  }
}

function sortWorkspaces(workspaces: StoredWorkspace[]): StoredWorkspace[] {
  return workspaces.slice().sort((a, b) => compareStrings(a.name, b.name) || compareStrings(a.path, b.path));
}

function toIndexedSession(info: SessionInfo): IndexedSession {
  return { info, serialized: serializeSessionInfo(info) };
}

function compareSessions(a: IndexedSession, b: IndexedSession): number {
  const byModified = b.info.modified.getTime() - a.info.modified.getTime();
  if (byModified !== 0) return byModified;
  const byPath = compareStrings(a.info.path, b.info.path);
  if (byPath !== 0) return byPath;
  return compareStrings(a.info.id, b.info.id);
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sessionListVersion(sessions: IndexedSession[]): string {
  const signature = JSON.stringify(sessions.map((session) => ({
    path: session.serialized.path,
    modified: session.serialized.modified,
    name: session.serialized.name ?? null,
    messageCount: session.serialized.messageCount,
    firstMessage: session.serialized.firstMessage,
  })));
  return createHash("sha256").update(signature).digest("base64url");
}

function encodeCursor(cursor: CursorPayload): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): CursorPayload {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid workspace sessions cursor");
  }
  if (!decoded || typeof decoded !== "object") throw new Error("invalid workspace sessions cursor");
  const value = decoded as Record<string, unknown>;
  const offset = value.offset;
  if (
    typeof value.workspacePath !== "string"
    || typeof value.listVersion !== "string"
    || typeof offset !== "number"
    || !Number.isInteger(offset)
    || offset < WORKSPACE_SESSIONS_WINDOW_LIMIT
  ) {
    throw new Error("invalid workspace sessions cursor");
  }
  return {
    workspacePath: value.workspacePath,
    listVersion: value.listVersion,
    offset,
  };
}
