import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { CwdPolicy } from "./cwd.js";
import { validateCwdTarget } from "./cwd.js";
import type { InvalidUrlStateKind, ServerUrlState } from "./url-state.js";
import { loadWorkspaceRegistry } from "./workspace-store.js";
import { validateSessionPointer } from "./url-session-startup.js";

export type RuntimeTarget =
  | { kind: "cwd_required"; message: string; value?: string }
  | { kind: "invalid_url"; invalidKind: InvalidUrlStateKind; value: string | null; message: string }
  | { kind: "cwd"; cwd: string; source: "url" | "lastCwd" }
  | { kind: "session"; sessionPath: string; cwd: string; source: "url" };

type ValidRuntimeTarget = Extract<RuntimeTarget, { kind: "cwd" | "session" }>;

export async function resolveRuntimeTarget(args: {
  urlState: ServerUrlState;
  agentDir: string;
  sessionDir?: string;
  policy: CwdPolicy;
}): Promise<RuntimeTarget> {
  const { urlState, agentDir, sessionDir, policy } = args;

  if (urlState.kind === "cwd") {
    return { kind: "cwd", cwd: urlState.cwd, source: "url" };
  }

  if (urlState.kind === "invalid") {
    return {
      kind: "invalid_url",
      invalidKind: urlState.invalidKind,
      value: urlState.value,
      message: urlState.message,
    };
  }

  if (urlState.kind === "session") {
    const sessionValidation = validateSessionPointer(urlState.sessionPath);
    if (sessionValidation.ok === false) {
      return {
        kind: "invalid_url",
        invalidKind: "session",
        value: urlState.sessionPath,
        message: `Could not open URL session: ${sessionValidation.reason}`,
      };
    }

    const sessionManager = SessionManager.open(urlState.sessionPath, sessionDir);
    const sessionCwd = sessionManager.getCwd();
    try {
      return {
        kind: "session",
        source: "url",
        sessionPath: urlState.sessionPath,
        cwd: validateCwdTarget(sessionCwd, policy),
      };
    } catch (error) {
      return {
        kind: "invalid_url",
        invalidKind: "session_cwd",
        value: sessionCwd,
        message: `Could not open URL session working directory: ${messageFrom(error)}`,
      };
    }
  }

  const registry = loadWorkspaceRegistry(agentDir);
  if (!registry.lastCwd) {
    return {
      kind: "cwd_required",
      message: "Choose a working directory to start pi-webui.",
    };
  }

  try {
    return {
      kind: "cwd",
      source: "lastCwd",
      cwd: validateCwdTarget(registry.lastCwd, policy),
    };
  } catch (error) {
    return {
      kind: "cwd_required",
      value: registry.lastCwd,
      message: `Saved working directory is unavailable: ${messageFrom(error)}`,
    };
  }
}

export function invalidUrlPayloadForTarget(
  target: Extract<RuntimeTarget, { kind: "invalid_url" }>,
): { kind: InvalidUrlStateKind; value: string | null; message: string } {
  return {
    kind: target.invalidKind,
    value: target.value,
    message: target.message,
  };
}

export function cwdRequiredPayloadForTarget(
  target: Extract<RuntimeTarget, { kind: "cwd_required" }>,
): { message: string; value?: string } {
  return target.value === undefined
    ? { message: target.message }
    : { message: target.message, value: target.value };
}

export function runtimeSessionManagerForTarget(args: {
  target: ValidRuntimeTarget;
  sessionDir?: string;
}): SessionManager {
  if (args.target.kind === "cwd") {
    return SessionManager.create(args.target.cwd, args.sessionDir);
  }
  return SessionManager.open(args.target.sessionPath, args.sessionDir);
}

export function assertRuntimeMatchesTarget(args: {
  target: ValidRuntimeTarget;
  runtimeCwd: string;
}): void {
  if (args.runtimeCwd !== args.target.cwd) {
    throw new Error(`Runtime cwd mismatch: expected ${args.target.cwd}, got ${args.runtimeCwd}`);
  }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
