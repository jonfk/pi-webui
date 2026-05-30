import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWebSocketUrl,
  createBrowserUrlState,
  makeCwdUrl,
  makeSessionUrl,
  parseBrowserUrl,
} from "../public/url-state.mjs";

test("parseBrowserUrl reads URL Session Pointers and URL Cwd Pointers", () => {
  assert.deepEqual(parseBrowserUrl("http://localhost/?session=%2Ftmp%2Fs.jsonl"), {
    kind: "session",
    sessionFile: "/tmp/s.jsonl",
  });
  assert.deepEqual(parseBrowserUrl("http://localhost/?cwd=%2Fwork%2Fproject"), {
    kind: "cwd",
    cwd: "/work/project",
  });
});

test("parseBrowserUrl treats missing URL state as new session cwd mode", () => {
  assert.deepEqual(parseBrowserUrl("http://localhost/?debug=1"), { kind: "new" });
});

test("parseBrowserUrl reports browser grammar conflicts without validating paths", () => {
  assert.deepEqual(parseBrowserUrl("http://localhost/?session=%2Ftmp%2Fs.jsonl&cwd=%2Fwork"), {
    kind: "invalid",
    invalidKind: "conflict",
    value: null,
  });
});

test("buildWebSocketUrl targets /ws and copies only URL state params", () => {
  const url = buildWebSocketUrl({
    protocol: "https:",
    host: "example.test:8443",
    href: "https://example.test:8443/app?debug=1&session=%2Ftmp%2Fs.jsonl&cwd=%2Fwork",
  });
  assert.equal(url, "wss://example.test:8443/ws?session=%2Ftmp%2Fs.jsonl&cwd=%2Fwork");
});

test("makeSessionUrl and makeCwdUrl return canonical root URLs", () => {
  assert.equal(makeSessionUrl("/tmp/space name/session.jsonl", "http://localhost/old?debug=1"), "/?session=%2Ftmp%2Fspace+name%2Fsession.jsonl");
  assert.equal(makeCwdUrl("/tmp/project", "http://localhost/old?debug=1"), "/?cwd=%2Ftmp%2Fproject");
});

function makeTracker(href = "http://localhost/") {
  const location = {
    href,
    protocol: new URL(href).protocol,
    host: new URL(href).host,
  };
  const calls = [];
  const listeners = [];
  const history = {
    replaceState: (...args) => {
      calls.push(["replaceState", ...args]);
      location.href = new URL(args[2], location.href).href;
    },
    pushState: (...args) => {
      calls.push(["pushState", ...args]);
      location.href = new URL(args[2], location.href).href;
    },
  };
  let reloadCount = 0;
  const addEventListener = (type, listener) => listeners.push([type, listener]);
  const state = createBrowserUrlState({
    location,
    history,
    reload: () => { reloadCount += 1; },
    addEventListener,
  });
  return { state, location, calls, listeners, reloadCount: () => reloadCount };
}

test("canonicalizeCwdPointer replaces a new URL with a cwd URL", () => {
  const { state, calls, location } = makeTracker("http://localhost/");
  state.canonicalizeCwdPointer("/work/project");
  assert.deepEqual(calls.map((c) => c[0]), ["replaceState"]);
  assert.equal(location.href, "http://localhost/?cwd=%2Fwork%2Fproject");
});

test("canonicalizeCwdPointer replaces a noncanonical cwd URL", () => {
  const { state, calls, location } = makeTracker("http://localhost/?cwd=~");
  state.canonicalizeCwdPointer("/Users/example");
  assert.deepEqual(calls.map((c) => c[0]), ["replaceState"]);
  assert.equal(location.href, "http://localhost/?cwd=%2FUsers%2Fexample");
});

test("canonicalizeCwdPointer no-ops for canonical cwd and session URLs", () => {
  const canonical = makeTracker("http://localhost/?cwd=%2Fwork%2Fproject");
  canonical.state.canonicalizeCwdPointer("/work/project");
  assert.equal(canonical.calls.length, 0);

  const session = makeTracker("http://localhost/?session=%2Ftmp%2Fs.jsonl");
  session.state.canonicalizeCwdPointer("/work/project");
  assert.equal(session.calls.length, 0);
});

test("promoteAcceptedCwdPointerPrompt replaces the first accepted cwd pointer prompt", () => {
  const { state, calls, location } = makeTracker("http://localhost/?cwd=%2Fwork");
  state.markCwdPointerPromptSent();
  state.promoteAcceptedCwdPointerPrompt("/tmp/session.jsonl");
  assert.deepEqual(calls.map((c) => c[0]), ["replaceState"]);
  assert.equal(location.href, "http://localhost/?session=%2Ftmp%2Fsession.jsonl");
});

test("syncDurableSession pushes between distinct durable sessions", () => {
  const { state, calls, location } = makeTracker("http://localhost/?session=%2Ftmp%2Fone.jsonl");
  state.syncDurableSession("/tmp/two.jsonl");
  assert.deepEqual(calls.map((c) => c[0]), ["pushState"]);
  assert.equal(location.href, "http://localhost/?session=%2Ftmp%2Ftwo.jsonl");
});

test("syncDurableSession is a no-op for same session, invalid URLs, and unprompted cwd URLs", () => {
  makeTracker("http://localhost/?session=%2Ftmp%2Fs.jsonl").state.syncDurableSession("/tmp/s.jsonl");
  const same = makeTracker("http://localhost/?session=%2Ftmp%2Fs.jsonl");
  same.state.syncDurableSession("/tmp/s.jsonl");
  assert.equal(same.calls.length, 0);

  const invalid = makeTracker("http://localhost/?session=%2Ftmp%2Fs.jsonl&cwd=%2Fwork");
  invalid.state.syncDurableSession("/tmp/other.jsonl");
  assert.equal(invalid.calls.length, 0);

  const cwd = makeTracker("http://localhost/?cwd=%2Fwork");
  cwd.state.syncDurableSession("/tmp/s.jsonl");
  assert.equal(cwd.calls.length, 0);
});

test("syncDurableSession can explicitly move from cwd pointer to session pointer", () => {
  const { state, calls, location } = makeTracker("http://localhost/?cwd=%2Fwork");
  state.syncDurableSession("/tmp/s.jsonl", { allowFromCwdPointer: true });
  assert.deepEqual(calls.map((c) => c[0]), ["pushState"]);
  assert.equal(location.href, "http://localhost/?session=%2Ftmp%2Fs.jsonl");
});

test("syncCwdPointer pushes when cwd changes and no-ops for same cwd", () => {
  const { state, calls, location } = makeTracker("http://localhost/?cwd=%2Fone");
  state.syncCwdPointer("/one");
  assert.equal(calls.length, 0);
  state.syncCwdPointer("/two");
  assert.deepEqual(calls.map((c) => c[0]), ["pushState"]);
  assert.equal(location.href, "http://localhost/?cwd=%2Ftwo");
});

test("URL transition intent suppresses transient session state before cwd command result", () => {
  const { state, calls, location } = makeTracker("http://localhost/?session=%2Ftmp%2Fold.jsonl");

  state.observeCommandStarted("slash:new");
  state.observeSessionState({ sessionFile: "/tmp/fresh-empty.jsonl" });
  state.observeCommandSucceeded("slash:new", { cwd: "/work/project" });

  assert.deepEqual(calls.map((c) => c[0]), ["pushState"]);
  assert.equal(location.href, "http://localhost/?cwd=%2Fwork%2Fproject");
});

test("URL transition intent promotes durable session commands after command success", () => {
  const { state, calls, location } = makeTracker("http://localhost/?cwd=%2Fwork");

  state.observeCommandStarted("slash:resume");
  state.observeSessionState({ sessionFile: "/tmp/resumed.jsonl" });
  assert.equal(calls.length, 0);

  state.observeCommandSucceeded("slash:resume", {});
  assert.deepEqual(calls.map((c) => c[0]), ["pushState"]);
  assert.equal(location.href, "http://localhost/?session=%2Ftmp%2Fresumed.jsonl");
});

test("recovery target commands update URL state from command data", () => {
  const cwd = makeTracker("http://localhost/?session=%2Ftmp%2Fbad.jsonl");
  cwd.state.observeCommandStarted("select_cwd");
  cwd.state.observeCommandSucceeded("select_cwd", { cwd: "/work/project" });
  assert.deepEqual(cwd.calls.map((c) => c[0]), ["pushState"]);
  assert.equal(cwd.location.href, "http://localhost/?cwd=%2Fwork%2Fproject");

  const session = makeTracker("http://localhost/?cwd=%2Fwork");
  session.state.observeCommandStarted("select_session");
  session.state.observeCommandSucceeded("select_session", { sessionPath: "/tmp/recovered.jsonl" });
  assert.deepEqual(session.calls.map((c) => c[0]), ["pushState"]);
  assert.equal(session.location.href, "http://localhost/?session=%2Ftmp%2Frecovered.jsonl");
});

test("installPopstateReload registers one Back/Forward reload handler", () => {
  const tracker = makeTracker("http://localhost/?cwd=%2Fwork");
  tracker.state.installPopstateReload();
  tracker.state.installPopstateReload();
  assert.equal(tracker.listeners.length, 1);
  assert.equal(tracker.listeners[0][0], "popstate");
  tracker.listeners[0][1]();
  assert.equal(tracker.reloadCount(), 1);
});

test("navigate helpers assign canonical URLs", () => {
  const { state, location } = makeTracker("http://localhost/?cwd=%2Fwork");
  state.navigateToSession("/tmp/s.jsonl");
  assert.equal(location.href, "/?session=%2Ftmp%2Fs.jsonl");
  state.navigateToCwd("/tmp/project");
  assert.equal(location.href, "/?cwd=%2Ftmp%2Fproject");
});
