import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export type CwdPolicy = {
  homeDir: string;
  allowAnyCwd: boolean;
};

export function expandTildePath(path: string, policy: CwdPolicy): string {
  if (!path) return path;
  if (path === "~") return policy.homeDir;
  if (path.startsWith("~/")) return resolve(policy.homeDir, path.slice(2));
  return path;
}

export function validateCwdTarget(target: string, policy: CwdPolicy): string {
  if (!target) throw new Error("path is required");
  const expanded = expandTildePath(target, policy);
  if (!isAbsolute(expanded)) throw new Error("path must be absolute");
  const resolved = resolve(expanded);
  if (!existsSync(resolved)) throw new Error(`path does not exist: ${resolved}`);
  if (!statSync(resolved).isDirectory()) throw new Error(`not a directory: ${resolved}`);
  if (
    !policy.allowAnyCwd &&
    policy.homeDir &&
    resolved !== policy.homeDir &&
    !resolved.startsWith(`${policy.homeDir}/`)
  ) {
    throw new Error(`path must be inside ${policy.homeDir} (set PI_WEBUI_CWD_ALLOW_ANY=1 to override)`);
  }
  return resolved;
}

export function isCwdReachable(resolved: string, policy: CwdPolicy): boolean {
  if (policy.allowAnyCwd) return true;
  if (!policy.homeDir) return true;
  if (resolved === policy.homeDir) return true;
  if (resolved.startsWith(`${policy.homeDir}/`)) return true;
  return policy.homeDir.startsWith(`${resolved}/`);
}

export function listDirectories(
  target: string,
  policy: CwdPolicy,
): { path: string; entries: Array<{ name: string; path: string }> } {
  const expanded = expandTildePath(target, policy);
  if (!isAbsolute(expanded)) throw new Error("path must be absolute");
  const resolved = resolve(expanded);
  if (!existsSync(resolved)) throw new Error(`path does not exist: ${resolved}`);
  if (!statSync(resolved).isDirectory()) throw new Error(`not a directory: ${resolved}`);
  if (!isCwdReachable(resolved, policy)) {
    throw new Error(`path must be inside ${policy.homeDir} (set PI_WEBUI_CWD_ALLOW_ANY=1 to override)`);
  }
  const entries = readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.isDirectory()) return false;
      if (entry.name.startsWith(".")) return false;
      return true;
    })
    .map((entry) => ({ name: entry.name, path: resolve(resolved, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { path: resolved, entries };
}
