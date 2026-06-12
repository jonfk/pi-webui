import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const packageRoot = new URL("..", import.meta.url);

test("build emits generated client assets and the shell references them", () => {
  const root = packageRoot.pathname;
  assert.equal(existsSync(join(root, "dist/server/index.js")), true);
  assert.equal(existsSync(join(root, "dist/client/sidebar.js")), true);
  assert.equal(existsSync(join(root, "dist/client/sidebar.css")), true);

  const index = readFileSync(join(root, "public/index.html"), "utf8");
  assert.match(index, /id="workspace-sidebar-root"/);
  assert.match(index, /href="\/client\/sidebar\.css"/);
  assert.match(index, /src="\/client\/sidebar\.js"/);
  assert.ok(index.indexOf('src="/app.js"') < index.indexOf('src="/client/sidebar.js"'));
});

test("shell owns the sidebar runtime bridge before the React island mounts", () => {
  const root = packageRoot.pathname;
  const app = readFileSync(join(root, "public/app.js"), "utf8");
  const sidebarEntry = readFileSync(join(root, "src/client/sidebar/main.tsx"), "utf8");

  assert.match(app, /window\.piWebuiSidebarBridge\s*=/);
  assert.match(app, /getCurrentTarget:\s*getSidebarCurrentTarget/);
  assert.match(app, /send\(\{\s*type:\s*"open_cwd",\s*cwd\s*\}\)/);
  assert.match(app, /send\(\{\s*type:\s*"switch_session",\s*sessionPath\s*\}\)/);
  assert.match(app, /syncSidebarCurrentTarget\(\)/);
  assert.match(sidebarEntry, /window\.piWebuiSidebarBridge is required before mounting the sidebar/);
});

test("sidebar client owns phase four UI state over typed tRPC reads", () => {
  const root = packageRoot.pathname;
  const sidebarEntry = readFileSync(join(root, "src/client/sidebar/main.tsx"), "utf8");
  const sidebarCss = readFileSync(join(root, "src/client/sidebar/sidebar.css"), "utf8");

  assert.match(sidebarEntry, /inferRouterOutputs<AppRouter>/);
  assert.match(sidebarEntry, /\/api\/trpc\/\$\{path\}/);
  assert.match(sidebarEntry, /pi-webui:sidebar-visible/);
  assert.match(sidebarEntry, /pi-webui:sidebar-expanded-workspaces/);
  assert.match(sidebarEntry, /workspaceSessions\(\{/);
  assert.match(sidebarEntry, /limit:\s*PAGE_LIMIT/);
  assert.match(sidebarEntry, /stale workspace sessions cursor/);
  assert.match(sidebarEntry, /bridge\.openCwd\(cwd\)/);
  assert.match(sidebarEntry, /bridge\.switchSession\(sessionPath\)/);
  assert.match(sidebarCss, /workspace-sidebar-desktop-visible \.app-shell/);
  assert.match(sidebarCss, /@media \(max-width: 899px\)/);
  assert.match(sidebarCss, /\.workspace-sidebar-backdrop/);
});
