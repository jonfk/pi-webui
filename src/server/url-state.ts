import { isAbsolute } from "node:path";
import type { CwdPolicy } from "./cwd.js";
import { validateCwdTarget } from "./cwd.js";

export type InvalidUrlStateKind = "conflict" | "cwd" | "session" | "session_cwd";

export type ServerUrlState =
  | { kind: "new" }
  | { kind: "cwd"; cwd: string }
  | { kind: "session"; sessionPath: string }
  | {
      kind: "invalid";
      invalidKind: "conflict" | "cwd" | "session";
      value: string | null;
      message: string;
    };

export function parseServerUrlState(
  searchParams: URLSearchParams,
  policy: CwdPolicy,
): ServerUrlState {
  const hasSession = searchParams.has("session");
  const hasCwd = searchParams.has("cwd");

  if (hasSession && hasCwd) {
    return {
      kind: "invalid",
      invalidKind: "conflict",
      value: null,
      message: "URL cannot include both session and cwd.",
    };
  }

  if (hasCwd) {
    const value = searchParams.get("cwd") ?? "";
    try {
      return { kind: "cwd", cwd: validateCwdTarget(value, policy) };
    } catch (error) {
      return {
        kind: "invalid",
        invalidKind: "cwd",
        value,
        message: `Could not open URL working directory: ${messageFrom(error)}`,
      };
    }
  }

  if (hasSession) {
    const value = searchParams.get("session") ?? "";
    if (!value) {
      return {
        kind: "invalid",
        invalidKind: "session",
        value,
        message: "Could not open URL session: path is required",
      };
    }
    if (!isAbsolute(value)) {
      return {
        kind: "invalid",
        invalidKind: "session",
        value,
        message: "Could not open URL session: path must be absolute",
      };
    }
    return { kind: "session", sessionPath: value };
  }

  return { kind: "new" };
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
