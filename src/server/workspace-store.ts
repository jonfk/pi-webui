import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export type StoredWorkspace = {
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceRegistry = {
  version: 1;
  activePath?: string;
  workspaces: StoredWorkspace[];
};

const WORKSPACES_FILE = "workspaces.json";

function registryPath(agentDir: string): string {
  return join(agentDir, WORKSPACES_FILE);
}

function assertWorkspaceRegistry(value: unknown): asserts value is WorkspaceRegistry {
  if (!value || typeof value !== "object") throw new Error("Invalid workspace registry");
  const registry = value as Record<string, unknown>;
  if (registry.version !== 1) throw new Error("Unsupported workspace registry version");
  if (registry.activePath !== undefined && typeof registry.activePath !== "string") {
    throw new Error("Invalid workspace registry activePath");
  }
  if (!Array.isArray(registry.workspaces)) throw new Error("Invalid workspace registry workspaces");
  for (const workspace of registry.workspaces) {
    if (!workspace || typeof workspace !== "object") throw new Error("Invalid workspace entry");
    const entry = workspace as Record<string, unknown>;
    for (const key of ["name", "path", "createdAt", "updatedAt"]) {
      if (typeof entry[key] !== "string" || entry[key] === "") {
        throw new Error(`Invalid workspace entry ${key}`);
      }
    }
  }
}

function emptyRegistry(): WorkspaceRegistry {
  return { version: 1, workspaces: [] };
}

export function loadWorkspaceRegistry(agentDir: string): WorkspaceRegistry {
  const path = registryPath(agentDir);
  if (!existsSync(path)) return emptyRegistry();
  const registry = JSON.parse(readFileSync(path, "utf8"));
  assertWorkspaceRegistry(registry);
  return registry;
}

export function saveWorkspaceRegistry(agentDir: string, registry: WorkspaceRegistry): void {
  assertWorkspaceRegistry(registry);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(registryPath(agentDir), JSON.stringify(registry, null, 2) + "\n");
}

function defaultWorkspaceName(path: string): string {
  return basename(path) || path;
}

export function addWorkspace(agentDir: string, path: string, name?: string): StoredWorkspace {
  const registry = loadWorkspaceRegistry(agentDir);
  const workspaceName = (name || defaultWorkspaceName(path)).trim();
  if (!workspaceName) throw new Error("workspace name is required");
  if (registry.workspaces.some((workspace) => workspace.name === workspaceName)) {
    throw new Error(`workspace already exists: ${workspaceName}`);
  }
  if (registry.workspaces.some((workspace) => workspace.path === path)) {
    throw new Error(`workspace path already exists: ${path}`);
  }
  const now = new Date().toISOString();
  const workspace = { name: workspaceName, path, createdAt: now, updatedAt: now };
  registry.workspaces.push(workspace);
  saveWorkspaceRegistry(agentDir, registry);
  return workspace;
}

export function removeWorkspace(agentDir: string, selector: string): StoredWorkspace {
  const registry = loadWorkspaceRegistry(agentDir);
  const index = registry.workspaces.findIndex(
    (workspace) => workspace.name === selector || workspace.path === selector,
  );
  if (index === -1) throw new Error(`workspace not found: ${selector}`);
  const [removed] = registry.workspaces.splice(index, 1);
  if (registry.activePath === removed.path) delete registry.activePath;
  saveWorkspaceRegistry(agentDir, registry);
  return removed;
}

export function findWorkspace(registry: WorkspaceRegistry, selector: string): StoredWorkspace | undefined {
  return registry.workspaces.find(
    (workspace) => workspace.name === selector || workspace.path === selector,
  );
}

export function setActiveWorkspace(agentDir: string, path: string): void {
  const registry = loadWorkspaceRegistry(agentDir);
  if (!registry.workspaces.some((workspace) => workspace.path === path)) {
    throw new Error(`workspace path is not registered: ${path}`);
  }
  registry.activePath = path;
  saveWorkspaceRegistry(agentDir, registry);
}
