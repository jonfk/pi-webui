import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { CwdPolicy } from "./cwd.js";
import { validateCwdTarget } from "./cwd.js";
import type { InvalidUrlStateKind, ServerUrlState } from "./url-state.js";
import type { SerializedSessionInfo } from "./session-info.js";
import { listSerializedSessions } from "./session-info.js";

export type InvalidUrlStatePayload = {
  kind: InvalidUrlStateKind;
  value: string | null;
  message: string;
  defaultCwd: string;
  sessions: {
    currentProject: SerializedSessionInfo[];
    allProjects: SerializedSessionInfo[];
  };
};

export type InitialUrlSession =
  | { kind: "valid"; source: "new" | "cwd" | "session"; cwd: string; sessionManager: SessionManager }
  | { kind: "invalid"; payload: InvalidUrlStatePayload };

export async function resolveInitialUrlSession(args: {
  urlState: ServerUrlState;
  defaultCwd: string;
  sessionDir?: string;
  policy: CwdPolicy;
}): Promise<InitialUrlSession> {
  const { urlState, defaultCwd, sessionDir, policy } = args;

  if (urlState.kind === "new") {
    return {
      kind: "valid",
      source: "new",
      cwd: defaultCwd,
      sessionManager: SessionManager.create(defaultCwd, sessionDir),
    };
  }

  if (urlState.kind === "cwd") {
    return {
      kind: "valid",
      source: "cwd",
      cwd: urlState.cwd,
      sessionManager: SessionManager.create(urlState.cwd, sessionDir),
    };
  }

  if (urlState.kind === "invalid") {
    return invalidPayload({
      kind: urlState.invalidKind,
      value: urlState.value,
      message: urlState.message,
      defaultCwd,
      sessionDir,
    });
  }

  const sessionValidation = validateSessionPointer(urlState.sessionPath);
  if (sessionValidation.ok === false) {
    return invalidPayload({
      kind: "session",
      value: urlState.sessionPath,
      message: `Could not open URL session: ${sessionValidation.reason}`,
      defaultCwd,
      sessionDir,
    });
  }

  const sessionManager = SessionManager.open(urlState.sessionPath, sessionDir);
  const sessionCwd = sessionManager.getCwd();
  try {
    const cwd = validateCwdTarget(sessionCwd, policy);
    return { kind: "valid", source: "session", cwd, sessionManager };
  } catch (error) {
    return invalidPayload({
      kind: "session_cwd",
      value: sessionCwd,
      message: `Could not open URL session working directory: ${messageFrom(error)}`,
      defaultCwd,
      sessionDir,
    });
  }
}

async function invalidPayload(args: {
  kind: InvalidUrlStateKind;
  value: string | null;
  message: string;
  defaultCwd: string;
  sessionDir?: string;
}): Promise<InitialUrlSession> {
  return {
    kind: "invalid",
    payload: {
      kind: args.kind,
      value: args.value,
      message: args.message,
      defaultCwd: args.defaultCwd,
      sessions: await listSerializedSessions({
        cwd: args.defaultCwd,
        sessionDir: args.sessionDir,
      }),
    },
  };
}

function validateSessionPointer(sessionPath: string): { ok: true } | { ok: false; reason: string } {
  if (!sessionPath) return { ok: false, reason: "path is required" };
  if (!isAbsolute(sessionPath)) return { ok: false, reason: "path must be absolute" };
  if (!existsSync(sessionPath)) return { ok: false, reason: `path does not exist: ${sessionPath}` };
  if (!statSync(sessionPath).isFile()) return { ok: false, reason: `not a file: ${sessionPath}` };

  const firstLine = readFirstLine(sessionPath);
  if (!firstLine) return { ok: false, reason: "session file is empty" };

  let header: unknown;
  try {
    header = JSON.parse(firstLine);
  } catch {
    return { ok: false, reason: "first line is not valid JSON" };
  }

  if (!header || typeof header !== "object" || (header as { type?: unknown }).type !== "session") {
    return { ok: false, reason: "missing session header" };
  }
  if (typeof (header as { id?: unknown }).id !== "string" || !(header as { id: string }).id) {
    return { ok: false, reason: "session header id is required" };
  }
  if (typeof (header as { cwd?: unknown }).cwd !== "string" || !(header as { cwd: string }).cwd) {
    return { ok: false, reason: "session header cwd is required" };
  }

  return { ok: true };
}

function readFirstLine(path: string): string {
  const fd = openSync(path, "r");
  try {
    const chunks: Buffer[] = [];
    const buffer = Buffer.alloc(4096);
    let offset = 0;
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, offset);
      if (bytesRead === 0) break;
      const slice = buffer.subarray(0, bytesRead);
      const newline = slice.indexOf(10);
      if (newline !== -1) {
        chunks.push(slice.subarray(0, newline));
        break;
      }
      chunks.push(Buffer.from(slice));
      offset += bytesRead;
    }
    return Buffer.concat(chunks).toString("utf8").replace(/\r$/, "");
  } finally {
    closeSync(fd);
  }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
