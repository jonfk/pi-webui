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

test("parseBrowserUrl treats missing URL state as a Disposable New Session", () => {
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

test("canonicalizeDisposableCwd replaces a new URL with a cwd URL", () => {
  const { state, calls, location } = makeTracker("http://localhost/");
  state.canonicalizeDisposableCwd("/work/project");
  assert.deepEqual(calls.map((c) => c[0]), ["replaceState"]);
  assert.equal(location.href, "http://localhost/?cwd=%2Fwork%2Fproject");
});

test("promoteAcceptedDisposablePrompt replaces the first accepted disposable prompt", () => {
  const { state, calls, location } = makeTracker("http://localhost/?cwd=%2Fwork");
  state.markDisposablePromptSent();
  state.promoteAcceptedDisposablePrompt("/tmp/session.jsonl");
  assert.deepEqual(calls.map((c) => c[0]), ["replaceState"]);
  assert.equal(location.href, "http://localhost/?session=%2Ftmp%2Fsession.jsonl");
});

test("syncDurableSession pushes between distinct durable sessions", () => {
  const { state, calls, location } = makeTracker("http://localhost/?session=%2Ftmp%2Fone.jsonl");
  state.syncDurableSession("/tmp/two.jsonl");
  assert.deepEqual(calls.map((c) => c[0]), ["pushState"]);
  assert.equal(location.href, "http://localhost/?session=%2Ftmp%2Ftwo.jsonl");
});

test("syncDurableSession is a no-op for same session, invalid URLs, and unprompted disposable URLs", () => {
  makeTracker("http://localhost/?session=%2Ftmp%2Fs.jsonl").state.syncDurableSession("/tmp/s.jsonl");
  const same = makeTracker("http://localhost/?session=%2Ftmp%2Fs.jsonl");
  same.state.syncDurableSession("/tmp/s.jsonl");
  assert.equal(same.calls.length, 0);

  const invalid = makeTracker("http://localhost/?session=%2Ftmp%2Fs.jsonl&cwd=%2Fwork");
  invalid.state.syncDurableSession("/tmp/other.jsonl");
  assert.equal(invalid.calls.length, 0);

  const disposable = makeTracker("http://localhost/?cwd=%2Fwork");
  disposable.state.syncDurableSession("/tmp/s.jsonl");
  assert.equal(disposable.calls.length, 0);
});

test("syncDurableSession can explicitly move from disposable to durable session", () => {
  const { state, calls, location } = makeTracker("http://localhost/?cwd=%2Fwork");
  state.syncDurableSession("/tmp/s.jsonl", { allowFromDisposable: true });
  assert.deepEqual(calls.map((c) => c[0]), ["pushState"]);
  assert.equal(location.href, "http://localhost/?session=%2Ftmp%2Fs.jsonl");
});

test("syncDisposableCwd pushes when cwd changes and no-ops for same cwd", () => {
  const { state, calls, location } = makeTracker("http://localhost/?cwd=%2Fone");
  state.syncDisposableCwd("/one");
  assert.equal(calls.length, 0);
  state.syncDisposableCwd("/two");
  assert.deepEqual(calls.map((c) => c[0]), ["pushState"]);
  assert.equal(location.href, "http://localhost/?cwd=%2Ftwo");
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
