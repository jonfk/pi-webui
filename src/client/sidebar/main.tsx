import React from "react";
import { createRoot } from "react-dom/client";
import "./sidebar.css";

function PrototypeWorkspaceSidebar() {
  return (
    <div className="prototype-workspace-sidebar">
      Workspace sidebar prototype
    </div>
  );
}

const root = document.getElementById("workspace-sidebar-root");
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <PrototypeWorkspaceSidebar />
    </React.StrictMode>,
  );
}
