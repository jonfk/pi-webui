import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-webui-command-protocol-"));
  const homeDir = join(root, "home");
  const cwd = join(homeDir, "project");
  const otherCwd = join(homeDir, "other");
  const agentDir = join(root, "agent");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(otherCwd, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  return { root, homeDir, cwd, otherCwd, agentDir };
}

const fixture = makeFixture();
process.env.HOME = fixture.homeDir;
process.env.PI_CODING_AGENT_DIR = fixture.agentDir;
delete process.env.PI_WEBUI_CWD_ALLOW_ANY;

const { NativePiSessionController } = await import("../dist/server/index.js");
const { saveWorkspaceRegistry } = await import("../dist/server/workspace-store.js");

class FakeWs {
  readyState = 1;
  sent = [];

  send(raw) {
    this.sent.push(JSON.parse(raw));
  }

  clear() {
    this.sent = [];
  }
}

class FakeSession {
  constructor(cwd) {
    this.cwd = cwd;
    this.sessionId = `session-${cwd.split("/").pop()}`;
    this.sessionFile = null;
    this.sessionName = "";
    this.thinkingLevel = "medium";
    this.isStreaming = false;
    this.isCompacting = false;
    this.isRetrying = false;
    this.autoCompactionEnabled = true;
    this.steeringMode = "auto";
    this.followUpMode = "auto";
    this.messages = [];
    this.model = null;
    this.promptTemplates = [];
    this.extensionRunner = null;
  }

  async bindExtensions() {}

  subscribe() {
    return () => {};
  }

  getActiveToolNames() {
    return [];
  }

  getAllTools() {
    return [];
  }

  getContextUsage() {
    return null;
  }
}

class FakeRuntime {
  constructor(cwd) {
    this.cwd = cwd;
    this.session = new FakeSession(cwd);
    this.diagnostics = [];
  }
}

class FakeRuntimeHost {
  constructor() {
    this._runtime = undefined;
    this.selectedTarget = null;
    this.transitions = [];
  }

  get runtime() {
    return this._runtime;
  }

  async start(target) {
    this._runtime = new FakeRuntime(target.cwd);
    this.selectedTarget = target;
  }

  requireRuntime() {
    if (!this._runtime) throw new Error("Pi runtime is not initialized");
    return this._runtime;
  }

  async applyTransition(transition) {
    this.transitions.push(transition);
    this._runtime = new FakeRuntime(transition.cwd);
    const target = transition.kind === "session"
      ? {
          kind: "session",
          sessionPath: transition.sessionPath,
          cwd: transition.cwd,
          source: "recovery",
        }
      : { kind: "cwd", cwd: transition.cwd, source: "recovery" };
    this.selectedTarget = target;
    return { cancelled: false, target };
  }

  async dispose() {}
}

async function createController(urlState) {
  const ws = new FakeWs();
  const runtimeHost = new FakeRuntimeHost();
  const controller = new NativePiSessionController(ws, urlState, { runtimeHost });
  await controller.ready;
  return { ws, runtimeHost, controller };
}

function commandResult(ws, command) {
  const match = ws.sent.find((message) => (
    message.type === "command_result" && message.payload.command === command
  ));
  assert.ok(match, `expected ${command} command_result`);
  return match.payload;
}

function clearSavedCwd() {
  saveWorkspaceRegistry(fixture.agentDir, { version: 1, workspaces: [] });
}

test("open_cwd command returns cwd and runtime target changed effect", async () => {
  const { ws, controller } = await createController({ kind: "cwd", cwd: fixture.cwd });
  ws.clear();

  await controller.handle({ type: "open_cwd", cwd: fixture.otherCwd });

  assert.deepEqual(commandResult(ws, "open_cwd"), {
    command: "open_cwd",
    ok: true,
    data: { cwd: fixture.otherCwd },
    effects: [{
      type: "runtime_target_changed",
      target: { kind: "cwd", cwd: fixture.otherCwd },
    }],
  });
});

test("new_session command with cwd rejects with the public protocol error", async () => {
  const { ws, runtimeHost, controller } = await createController({ kind: "cwd", cwd: fixture.cwd });
  ws.clear();

  await controller.handle({ type: "new_session", cwd: fixture.otherCwd });

  assert.deepEqual(commandResult(ws, "new_session"), {
    command: "new_session",
    ok: false,
    error: "new_session does not accept cwd; use open_cwd",
  });
  assert.deepEqual(runtimeHost.transitions, []);
});

test("runtime-free open_cwd recovers from blocked startup", async () => {
  clearSavedCwd();
  const { ws, controller } = await createController({ kind: "new" });

  assert.equal(ws.sent[0].type, "cwd_required");
  ws.clear();

  await controller.handle({ type: "open_cwd", cwd: fixture.cwd });

  assert.equal(ws.sent.some((message) => message.type === "connected"), true);
  assert.deepEqual(commandResult(ws, "open_cwd"), {
    command: "open_cwd",
    ok: true,
    data: { cwd: fixture.cwd },
    effects: [{
      type: "runtime_target_changed",
      target: { kind: "cwd", cwd: fixture.cwd },
    }],
  });
});

test("runtime-free new_session command with cwd rejects with the public protocol error", async () => {
  clearSavedCwd();
  const { ws, controller } = await createController({ kind: "new" });
  ws.clear();

  await controller.handle({ type: "new_session", cwd: fixture.cwd });

  assert.deepEqual(commandResult(ws, "new_session"), {
    command: "new_session",
    ok: false,
    error: "new_session does not accept cwd; use open_cwd",
  });
});
