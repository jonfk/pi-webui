import React from "react";
import { createRoot } from "react-dom/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../server/sidebar-router.js";
import { IconChevron, IconFolder, IconPanelLeft, IconPlus, IconRefresh } from "./icons";
import "./sidebar.css";

const DESKTOP_QUERY = "(min-width: 900px)";
const SIDEBAR_VISIBLE_KEY = "pi-webui:sidebar-visible";
const EXPANDED_WORKSPACES_KEY = "pi-webui:sidebar-expanded-workspaces";
const PAGE_LIMIT = 10;

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

type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;
type WorkspaceIndex = RouterOutputs["sidebar"]["workspaceIndex"];
type WorkspaceIndexEntry = WorkspaceIndex["workspaces"][number];
type WorkspaceSession = WorkspaceIndexEntry["sessionsWindow"]["sessions"][number];
type WorkspaceSessionsInput = RouterInputs["sidebar"]["workspaceSessions"];
type WorkspaceSessionsPage = RouterOutputs["sidebar"]["workspaceSessions"];

type LoadStatus = "idle" | "loading" | "ready" | "error";
type PageStatus = "idle" | "loading" | "error" | "stale";

type WorkspacePageState = {
  sessions: WorkspaceSession[];
  nextCursor: string | null;
  hasMore: boolean;
  listVersion: string;
  status: PageStatus;
  error: string | null;
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

function useSidebarTarget() {
  return React.useSyncExternalStore(
    bridge.subscribeCurrentTarget,
    bridge.getCurrentTarget,
    bridge.getCurrentTarget,
  );
}

async function trpcQuery<TOutput>(path: string, input?: unknown): Promise<TOutput> {
  const url = new URL(`/api/trpc/${path}`, window.location.origin);
  if (input !== undefined) url.searchParams.set("input", JSON.stringify(input));

  const response = await fetch(url, { method: "GET", headers: { accept: "application/json" } });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(body.error?.message || `tRPC request failed: ${path}`);
  }
  return body.result.data as TOutput;
}

function workspaceIndex(): Promise<WorkspaceIndex> {
  return trpcQuery<WorkspaceIndex>("sidebar.workspaceIndex");
}

function workspaceSessions(input: WorkspaceSessionsInput): Promise<WorkspaceSessionsPage> {
  return trpcQuery<WorkspaceSessionsPage>("sidebar.workspaceSessions", input);
}

function readDesktopVisible(): boolean {
  const stored = window.localStorage.getItem(SIDEBAR_VISIBLE_KEY);
  if (stored === null) return true;
  return stored === "true";
}

function writeDesktopVisible(value: boolean) {
  window.localStorage.setItem(SIDEBAR_VISIBLE_KEY, value ? "true" : "false");
}

function readWorkspaceExpansionState(): Record<string, boolean> {
  const stored = window.localStorage.getItem(EXPANDED_WORKSPACES_KEY);
  if (!stored) return {};
  const parsed = JSON.parse(stored);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${EXPANDED_WORKSPACES_KEY} must contain a JSON object`);
  }
  return parsed as Record<string, boolean>;
}

function writeWorkspaceExpansionState(state: Record<string, boolean>) {
  window.localStorage.setItem(EXPANDED_WORKSPACES_KEY, JSON.stringify(state));
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = React.useState(() => window.matchMedia(query).matches);

  React.useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

function useBodyClass(className: string, enabled: boolean) {
  React.useEffect(() => {
    document.body.classList.toggle(className, enabled);
    return () => document.body.classList.remove(className);
  }, [className, enabled]);
}

function WorkspaceSidebarApp() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const target = useSidebarTarget();
  const [desktopVisible, setDesktopVisible] = React.useState(readDesktopVisible);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [workspaceExpansion, setWorkspaceExpansion] = React.useState(readWorkspaceExpansionState);
  const [catalog, setCatalog] = React.useState<WorkspaceIndex | null>(null);
  const [loadStatus, setLoadStatus] = React.useState<LoadStatus>("idle");
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const refreshingRef = React.useRef(false);
  const [pages, setPages] = React.useState<Record<string, WorkspacePageState>>({});

  const sidebarVisible = isDesktop ? desktopVisible : mobileOpen;

  useBodyClass("workspace-sidebar-desktop-visible", isDesktop && desktopVisible);
  useBodyClass("workspace-sidebar-mobile-open", !isDesktop && mobileOpen);

  const applyIndex = React.useCallback((next: WorkspaceIndex) => {
    setCatalog(next);
    setPages(Object.fromEntries(next.workspaces.map((workspace) => [
      workspace.path,
      {
        sessions: workspace.sessionsWindow.sessions,
        nextCursor: workspace.sessionsWindow.nextCursor,
        hasMore: workspace.sessionsWindow.hasMore,
        listVersion: workspace.sessionsWindow.listVersion,
        status: "idle" as PageStatus,
        error: null,
      },
    ])));
  }, []);

  const loadIndex = React.useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "refresh") {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      setRefreshing(true);
    } else {
      setLoadStatus("loading");
    }
    setLoadError(null);

    try {
      const next = await workspaceIndex();
      applyIndex(next);
      setLoadStatus("ready");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
      setLoadStatus("error");
    } finally {
      if (mode === "refresh") {
        refreshingRef.current = false;
        setRefreshing(false);
      }
    }
  }, [applyIndex]);

  React.useEffect(() => {
    void loadIndex("initial");
  }, [loadIndex]);

  React.useEffect(() => {
    if (isDesktop) setMobileOpen(false);
  }, [isDesktop]);

  React.useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  const toggleDesktopVisible = () => {
    setDesktopVisible((current) => {
      const next = !current;
      writeDesktopVisible(next);
      return next;
    });
  };

  const toggleWorkspace = (workspacePath: string) => {
    setWorkspaceExpansion((current) => {
      const next = { ...current, [workspacePath]: !(current[workspacePath] ?? true) };
      writeWorkspaceExpansionState(next);
      return next;
    });
  };

  const closeMobileAfterAction = () => {
    if (!isDesktop) setMobileOpen(false);
  };

  const startWorkspaceSession = (cwd: string) => {
    bridge.openCwd(cwd);
    closeMobileAfterAction();
  };

  const switchToSession = (sessionPath: string) => {
    bridge.switchSession(sessionPath);
    closeMobileAfterAction();
  };

  const loadMore = async (workspacePath: string) => {
    const state = pages[workspacePath];
    if (!state || !state.nextCursor || state.status === "loading") return;

    setPages((current) => ({
      ...current,
      [workspacePath]: { ...current[workspacePath], status: "loading", error: null },
    }));

    try {
      const page = await workspaceSessions({
        workspacePath,
        cursor: state.nextCursor,
        limit: PAGE_LIMIT,
      });
      setPages((current) => {
        const previous = current[workspacePath];
        return {
          ...current,
          [workspacePath]: {
            sessions: [...previous.sessions, ...page.sessions],
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
            listVersion: page.listVersion,
            status: "idle",
            error: null,
          },
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stale = message.includes("stale workspace sessions cursor");
      setPages((current) => ({
        ...current,
        [workspacePath]: {
          ...current[workspacePath],
          status: stale ? "stale" : "error",
          error: message,
        },
      }));
    }
  };

  const shell = (
    <WorkspaceSidebar
      catalog={catalog}
      pages={pages}
      loadStatus={loadStatus}
      loadError={loadError}
      refreshing={refreshing}
      target={target}
      workspaceExpansion={workspaceExpansion}
      onRefresh={() => void loadIndex("refresh")}
      onToggleWorkspace={toggleWorkspace}
      onLoadMore={(workspacePath) => void loadMore(workspacePath)}
      onNewSession={startWorkspaceSession}
      onSwitchSession={switchToSession}
      onHide={isDesktop ? toggleDesktopVisible : () => setMobileOpen(false)}
    />
  );

  return (
    <>
      {!sidebarVisible && (
        <button
          className="workspace-sidebar-toggle"
          type="button"
          aria-label="Show workspace sidebar"
          title="Show workspace sidebar"
          onClick={isDesktop ? toggleDesktopVisible : () => setMobileOpen(true)}
        >
          <IconPanelLeft />
        </button>
      )}
      {!isDesktop && mobileOpen && (
        <button
          className="workspace-sidebar-backdrop"
          type="button"
          aria-label="Close workspace sidebar"
          onClick={() => setMobileOpen(false)}
        />
      )}
      {sidebarVisible && shell}
    </>
  );
}

function WorkspaceSidebar(props: {
  catalog: WorkspaceIndex | null;
  pages: Record<string, WorkspacePageState>;
  loadStatus: LoadStatus;
  loadError: string | null;
  refreshing: boolean;
  target: SidebarCurrentTarget;
  workspaceExpansion: Record<string, boolean>;
  onRefresh(): void;
  onToggleWorkspace(workspacePath: string): void;
  onLoadMore(workspacePath: string): void;
  onNewSession(cwd: string): void;
  onSwitchSession(sessionPath: string): void;
  onHide(): void;
}) {
  const workspaces = props.catalog?.workspaces ?? [];
  const activeWorkspace = workspaces.find((workspace) => workspace.path === props.target.cwd) ?? null;
  const activeSession = findSession(workspaces, props.pages, props.target.sessionFile);
  const totalSessions = workspaces.reduce((sum, workspace) => sum + workspace.sessionCount, 0);

  return (
    <aside className="workspace-sidebar" aria-label="Workspace sidebar">
      <header className="workspace-sidebar__header">
        <div className="workspace-sidebar__context">
          <div className="workspace-sidebar__context-workspace">
            <IconFolder size={14} />
            <span>{activeWorkspace?.name ?? "No workspace"}</span>
          </div>
          <div className="workspace-sidebar__context-detail">
            {activeSession
              ? sessionTitle(activeSession)
              : `${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"} · ${totalSessions} session${totalSessions === 1 ? "" : "s"}`}
          </div>
        </div>
        <div className="workspace-sidebar__actions">
          <button
            className="workspace-sidebar__icon-button"
            type="button"
            aria-label="Refresh workspace sessions"
            title="Refresh workspace sessions"
            disabled={props.refreshing}
            onClick={props.onRefresh}
          >
            <IconRefresh className={props.refreshing ? "workspace-sidebar__spin" : undefined} />
          </button>
          <button
            className="workspace-sidebar__icon-button"
            type="button"
            aria-label="Hide workspace sidebar"
            title="Hide workspace sidebar"
            onClick={props.onHide}
          >
            <IconPanelLeft />
          </button>
        </div>
      </header>

      {props.loadStatus === "loading" && (
        <div className="workspace-sidebar__notice">loading workspaces...</div>
      )}

      {props.loadStatus === "error" && !props.catalog && (
        <div className="workspace-sidebar__notice workspace-sidebar__notice--error">
          <span>{props.loadError}</span>
          <button type="button" onClick={props.onRefresh} disabled={props.refreshing}>
            retry
          </button>
        </div>
      )}

      {props.loadStatus === "error" && props.catalog && (
        <div className="workspace-sidebar__notice workspace-sidebar__notice--error">
          <span>{props.loadError}</span>
        </div>
      )}

      {props.catalog && workspaces.length === 0 && (
        <div className="workspace-sidebar__empty">No saved workspaces</div>
      )}

      <div className="workspace-sidebar__groups">
        {workspaces.map((workspace) => {
          const expanded = props.workspaceExpansion[workspace.path] ?? true;
          const page = props.pages[workspace.path];
          return (
            <WorkspaceGroup
              key={workspace.path}
              workspace={workspace}
              page={page}
              expanded={expanded}
              activeCwd={props.target.cwd}
              activeSessionFile={props.target.sessionFile}
              onToggle={() => props.onToggleWorkspace(workspace.path)}
              onLoadMore={() => props.onLoadMore(workspace.path)}
              onNewSession={() => props.onNewSession(workspace.path)}
              onSwitchSession={props.onSwitchSession}
            />
          );
        })}
      </div>
    </aside>
  );
}

function WorkspaceGroup(props: {
  workspace: WorkspaceIndexEntry;
  page: WorkspacePageState | undefined;
  expanded: boolean;
  activeCwd: string | null;
  activeSessionFile: string | null;
  onToggle(): void;
  onLoadMore(): void;
  onNewSession(): void;
  onSwitchSession(sessionPath: string): void;
}) {
  const activeWorkspace = props.activeCwd === props.workspace.path;
  const sessions = props.page?.sessions ?? props.workspace.sessionsWindow.sessions;
  const hasMore = props.page?.hasMore ?? props.workspace.sessionsWindow.hasMore;
  const pageStatus = props.page?.status ?? "idle";
  const pageError = props.page?.error ?? null;

  return (
    <section className={`workspace-group${activeWorkspace ? " active" : ""}`}>
      <div className="workspace-group__header">
        <button
          className="workspace-group__toggle"
          type="button"
          aria-label={`${props.expanded ? "Collapse" : "Expand"} ${props.workspace.name}`}
          aria-expanded={props.expanded}
          onClick={props.onToggle}
        >
          <IconChevron size={14} className={`workspace-group__chevron${props.expanded ? " expanded" : ""}`} />
          <span className="workspace-group__name" title={props.workspace.path}>{props.workspace.name}</span>
          <span className="workspace-group__count">{props.workspace.sessionCount}</span>
        </button>
        <button
          className="workspace-group__new"
          type="button"
          aria-label={`Start new session in ${props.workspace.name}`}
          title={`Start new session in ${props.workspace.name}`}
          onClick={props.onNewSession}
        >
          <IconPlus size={14} />
        </button>
      </div>

      {props.expanded && (
        <div className="workspace-group__sessions">
          {sessions.length === 0 && (
            <div className="workspace-group__empty">No sessions yet</div>
          )}
          {sessions.map((session) => (
            <SessionRow
              key={session.path}
              session={session}
              active={session.path === props.activeSessionFile}
              onSelect={() => props.onSwitchSession(session.path)}
            />
          ))}
          {hasMore && (
            <button
              className={`workspace-group__more${pageStatus === "stale" ? " stale" : ""}`}
              type="button"
              disabled={pageStatus === "loading" || pageStatus === "stale"}
              title={pageStatus === "stale" ? "Refresh the sidebar before loading more sessions" : undefined}
              onClick={props.onLoadMore}
            >
              {pageStatus === "loading"
                ? "loading..."
                : pageStatus === "stale"
                  ? "refresh required"
                  : pageStatus === "error"
                    ? "retry show more"
                    : `show ${Math.max(0, props.workspace.sessionCount - sessions.length)} more`}
            </button>
          )}
          {pageStatus === "stale" && (
            <div className="workspace-group__page-error">Session list changed. Refresh to continue.</div>
          )}
          {pageStatus === "error" && pageError && (
            <div className="workspace-group__page-error">{pageError}</div>
          )}
        </div>
      )}
    </section>
  );
}

function SessionRow(props: {
  session: WorkspaceSession;
  active: boolean;
  onSelect(): void;
}) {
  return (
    <button
      className={`session-row-sidebar${props.active ? " active" : ""}`}
      type="button"
      aria-current={props.active ? "page" : undefined}
      onClick={props.onSelect}
    >
      <span className="session-row-sidebar__title">{sessionTitle(props.session)}</span>
      <span className="session-row-sidebar__meta">
        {formatRelativeTime(props.session.modified)} · {props.session.messageCount} msg
      </span>
    </button>
  );
}

function sessionTitle(session: WorkspaceSession): string {
  return session.name || session.firstMessage || `${session.id.slice(0, 8)}...`;
}

function findSession(
  workspaces: WorkspaceIndexEntry[],
  pages: Record<string, WorkspacePageState>,
  sessionFile: string | null,
): WorkspaceSession | null {
  if (!sessionFile) return null;
  for (const workspace of workspaces) {
    const sessions = pages[workspace.path]?.sessions ?? workspace.sessionsWindow.sessions;
    const match = sessions.find((session) => session.path === sessionFile);
    if (match) return match;
  }
  return null;
}

function formatRelativeTime(iso: string): string {
  const timestamp = new Date(iso).getTime();
  const diff = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

const root = document.getElementById("workspace-sidebar-root");
if (!root) throw new Error("#workspace-sidebar-root is required before mounting the sidebar");

createRoot(root).render(
  <React.StrictMode>
    <WorkspaceSidebarApp />
  </React.StrictMode>,
);
