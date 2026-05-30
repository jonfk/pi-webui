import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { CwdPolicy } from "./cwd.js";
import { validateCwdTarget } from "./cwd.js";
import type { RuntimeTarget } from "./runtime-target.js";
import { findWorkspace, loadWorkspaceRegistry } from "./workspace-store.js";
import { validateSessionPointer } from "./url-session-startup.js";

export type CwdTransitionSource =
  | "url_cwd_startup"
  | "picker"
  | "slash_cwd"
  | "workspace"
  | "new_session";

export type SessionTransitionSource =
  | "import"
  | "picker"
  | "switch_session";

export type TargetTransition =
  | { kind: "cwd"; cwd: string; source: CwdTransitionSource }
  | { kind: "session"; sessionPath: string; cwd: string; source: SessionTransitionSource };

export function transitionFromStartupTarget(target: RuntimeTarget): TargetTransition | null {
  if (target.kind === "cwd" && target.source === "url") {
    return { kind: "cwd", cwd: target.cwd, source: "url_cwd_startup" };
  }
  return null;
}

export function transitionToRuntimeTarget(transition: TargetTransition): Extract<RuntimeTarget, { kind: "cwd" | "session" }> {
  if (transition.kind === "cwd") {
    return { kind: "cwd", cwd: transition.cwd, source: "recovery" };
  }
  return {
    kind: "session",
    sessionPath: transition.sessionPath,
    cwd: transition.cwd,
    source: "recovery",
  };
}

export function resolveCwdTransition(args: {
  cwd: string;
  policy: CwdPolicy;
  source: Extract<CwdTransitionSource, "picker" | "slash_cwd" | "new_session">;
}): TargetTransition {
  return {
    kind: "cwd",
    cwd: validateCwdTarget(args.cwd, args.policy),
    source: args.source,
  };
}

export function resolveWorkspaceTransition(args: {
  selector: string;
  agentDir: string;
  policy: CwdPolicy;
}): TargetTransition & { workspace: NonNullable<ReturnType<typeof findWorkspace>> } {
  const registry = loadWorkspaceRegistry(args.agentDir);
  const workspace = findWorkspace(registry, args.selector);
  if (!workspace) throw new Error(`workspace not found: ${args.selector}`);
  return {
    kind: "cwd",
    cwd: validateCwdTarget(workspace.path, args.policy),
    source: "workspace",
    workspace,
  };
}

export function resolveSessionTransition(args: {
  sessionPath: string;
  sessionDir?: string;
  policy: CwdPolicy;
  source: SessionTransitionSource;
}): TargetTransition {
  const sessionValidation = validateSessionPointer(args.sessionPath);
  if (sessionValidation.ok === false) {
    throw new Error(sessionValidation.reason);
  }

  const sessionManager = SessionManager.open(args.sessionPath, args.sessionDir);
  return {
    kind: "session",
    sessionPath: args.sessionPath,
    cwd: validateCwdTarget(sessionManager.getCwd(), args.policy),
    source: args.source,
  };
}

export function shouldPersistLastCwd(transition: TargetTransition): boolean {
  if (transition.kind === "session" && transition.source === "import") return false;
  return true;
}

export class TargetTransitionApplicator {
  #inFlight = false;

  async apply<T>(
    transition: TargetTransition,
    applyTransition: (transition: TargetTransition) => Promise<T>,
  ): Promise<T> {
    if (this.#inFlight) {
      throw new Error("A runtime target transition is already in progress");
    }
    this.#inFlight = true;
    try {
      return await applyTransition(transition);
    } finally {
      this.#inFlight = false;
    }
  }
}
