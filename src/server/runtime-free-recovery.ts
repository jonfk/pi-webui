import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { CwdPolicy } from "./cwd.js";
import { listDirectories, validateCwdTarget } from "./cwd.js";
import { serializeSessionInfo } from "./session-info.js";
import type { RuntimeTarget } from "./runtime-target.js";
import { validateSessionPointer } from "./url-session-startup.js";
import { loadWorkspaceRegistry } from "./workspace-store.js";

type RecoveryTarget = Extract<RuntimeTarget, { kind: "cwd" | "session" }>;

export async function listAllRecoverySessions(): Promise<{
  allProjects: ReturnType<typeof serializeSessionInfo>[];
}> {
  const sessions = await SessionManager.listAll();
  return { allProjects: sessions.map(serializeSessionInfo) };
}

export async function listRecentRecoveryCwds(args: {
  agentDir: string;
  policy: CwdPolicy;
}): Promise<Array<{ cwd: string; modified: string; count: number }>> {
  const seen = new Map<string, { cwd: string; modified: number; count: number }>();
  const sessions = await SessionManager.listAll();

  for (const session of sessions) {
    if (!session?.cwd) continue;
    const resolved = validateIfReachable(session.cwd, args.policy);
    if (!resolved) continue;
    addRecent(seen, resolved, modifiedTime(session.modified), 1);
  }

  const registry = loadWorkspaceRegistry(args.agentDir);
  if (registry.lastCwd) {
    const resolved = validateIfReachable(registry.lastCwd, args.policy);
    if (resolved) addRecent(seen, resolved, Date.now(), 0);
  }

  return [...seen.values()]
    .sort((a, b) => b.modified - a.modified)
    .map((entry) => ({
      cwd: entry.cwd,
      modified: new Date(entry.modified).toISOString(),
      count: entry.count,
    }));
}

export function listRecoveryDir(args: {
  path: string;
  policy: CwdPolicy;
}): { path: string; entries: Array<{ name: string; path: string }> } {
  return listDirectories(args.path, args.policy);
}

export function selectRecoveryCwd(args: {
  cwd: string;
  policy: CwdPolicy;
}): { ok: true; target: RecoveryTarget } | { ok: false; error: string } {
  try {
    return {
      ok: true,
      target: {
        kind: "cwd",
        source: "recovery",
        cwd: validateCwdTarget(args.cwd, args.policy),
      },
    };
  } catch (error) {
    return { ok: false, error: messageFrom(error) };
  }
}

export function selectRecoverySession(args: {
  sessionPath: string;
  sessionDir?: string;
  policy: CwdPolicy;
}): { ok: true; target: RecoveryTarget } | { ok: false; error: string } {
  const sessionValidation = validateSessionPointer(args.sessionPath);
  if (sessionValidation.ok === false) {
    return { ok: false, error: sessionValidation.reason };
  }

  try {
    const sessionManager = SessionManager.open(args.sessionPath, args.sessionDir);
    return {
      ok: true,
      target: {
        kind: "session",
        source: "recovery",
        sessionPath: args.sessionPath,
        cwd: validateCwdTarget(sessionManager.getCwd(), args.policy),
      },
    };
  } catch (error) {
    return { ok: false, error: messageFrom(error) };
  }
}

function addRecent(
  seen: Map<string, { cwd: string; modified: number; count: number }>,
  cwd: string,
  modified: number,
  count: number,
): void {
  const existing = seen.get(cwd);
  if (!existing) {
    seen.set(cwd, { cwd, modified, count });
    return;
  }
  existing.count += count;
  if (modified > existing.modified) existing.modified = modified;
}

function modifiedTime(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return Date.parse(value) || 0;
  return 0;
}

function validateIfReachable(cwd: string, policy: CwdPolicy): string | null {
  try {
    return validateCwdTarget(cwd, policy);
  } catch {
    return null;
  }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
