import React from "react";
import { createRoot } from "react-dom/client";
import "./sidebar.css";

type SidebarCurrentTarget = {
  cwd: string | null;
  sessionFile: string | null;
};

type SidebarRuntimeBridge = {
  getCurrentTarget(): SidebarCurrentTarget;
  openCwd(cwd: string): void;
  switchSession(sessionPath: string): void;
  subscribeCurrentTarget(listener: () => void): () => void;
};

declare global {
  interface Window {
    piWebuiSidebarBridge?: SidebarRuntimeBridge;
  }
}

function requireSidebarBridge(): SidebarRuntimeBridge {
  const bridge = window.piWebuiSidebarBridge;
  if (!bridge) throw new Error("window.piWebuiSidebarBridge is required before mounting the sidebar");
  return bridge;
}

const bridge = requireSidebarBridge();

function WorkspaceSidebarShell() {
  const target = React.useSyncExternalStore(
    bridge.subscribeCurrentTarget,
    bridge.getCurrentTarget,
    bridge.getCurrentTarget,
  );

  return (
    <div className="workspace-sidebar-shell" aria-label="Workspace sidebar">
      <div className="workspace-sidebar-shell__title">Workspaces</div>
      <div className="workspace-sidebar-shell__target">
        <span>cwd</span>
        <strong>{target.cwd ?? "none"}</strong>
      </div>
      <div className="workspace-sidebar-shell__target">
        <span>session</span>
        <strong>{target.sessionFile ?? "none"}</strong>
      </div>
    </div>
  );
}

const root = document.getElementById("workspace-sidebar-root");
if (!root) throw new Error("#workspace-sidebar-root is required before mounting the sidebar");

createRoot(root).render(
  <React.StrictMode>
    <WorkspaceSidebarShell />
  </React.StrictMode>,
);
