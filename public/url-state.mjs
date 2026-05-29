export const URL_SESSION_PARAM = "session";
export const URL_CWD_PARAM = "cwd";

export function parseBrowserUrl(href) {
  const url = new URL(href, "http://localhost/");
  const hasSession = url.searchParams.has(URL_SESSION_PARAM);
  const hasCwd = url.searchParams.has(URL_CWD_PARAM);

  if (hasSession && hasCwd) {
    return { kind: "invalid", invalidKind: "conflict", value: null };
  }
  if (hasSession) {
    return { kind: "session", sessionFile: url.searchParams.get(URL_SESSION_PARAM) ?? "" };
  }
  if (hasCwd) {
    return { kind: "cwd", cwd: url.searchParams.get(URL_CWD_PARAM) ?? "" };
  }
  return { kind: "new" };
}

export function buildWebSocketUrl(locationLike) {
  const browserUrl = new URL(locationLike.href);
  const protocol = locationLike.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = new URL(`${protocol}//${locationLike.host}/ws`);
  copyUrlStateParam(browserUrl.searchParams, wsUrl.searchParams, URL_SESSION_PARAM);
  copyUrlStateParam(browserUrl.searchParams, wsUrl.searchParams, URL_CWD_PARAM);
  return wsUrl.toString();
}

export function makeSessionUrl(sessionFile, href) {
  const url = new URL("/", absoluteBase(href));
  url.search = "";
  url.searchParams.set(URL_SESSION_PARAM, sessionFile);
  return url.pathname + url.search;
}

export function makeCwdUrl(cwd, href) {
  const url = new URL("/", absoluteBase(href));
  url.search = "";
  url.searchParams.set(URL_CWD_PARAM, cwd);
  return url.pathname + url.search;
}

export function createBrowserUrlState({ location, history, reload, addEventListener }) {
  let disposablePromptSent = false;
  let popstateInstalled = false;
  const on = addEventListener || globalThis.addEventListener?.bind(globalThis);

  const replace = (url) => history.replaceState(null, "", url);
  const push = (url) => history.pushState(null, "", url);

  return {
    current() {
      return parseBrowserUrl(location.href);
    },

    webSocketUrl() {
      return buildWebSocketUrl(location);
    },

    installPopstateReload() {
      if (popstateInstalled) return;
      popstateInstalled = true;
      on?.("popstate", () => reload());
    },

    canonicalizeDisposableCwd(defaultCwd) {
      if (this.current().kind !== "new") return;
      replace(makeCwdUrl(defaultCwd, location.href));
    },

    syncDurableSession(sessionFile, options = {}) {
      if (!sessionFile) return;
      const state = this.current();
      if (state.kind === "invalid") return;
      if (state.kind === "session") {
        if (state.sessionFile === sessionFile) return;
        push(makeSessionUrl(sessionFile, location.href));
        return;
      }
      if (options.allowFromDisposable) {
        push(makeSessionUrl(sessionFile, location.href));
      }
    },

    markDisposablePromptSent() {
      disposablePromptSent = true;
    },

    promoteAcceptedDisposablePrompt(sessionFile) {
      if (!disposablePromptSent || !sessionFile) return;
      const state = this.current();
      if (state.kind !== "new" && state.kind !== "cwd") return;
      disposablePromptSent = false;
      replace(makeSessionUrl(sessionFile, location.href));
    },

    syncDisposableCwd(cwd) {
      if (!cwd) return;
      const state = this.current();
      if (state.kind === "cwd" && state.cwd === cwd) return;
      push(makeCwdUrl(cwd, location.href));
    },

    navigateToSession(sessionFile) {
      location.href = makeSessionUrl(sessionFile, location.href);
    },

    navigateToCwd(cwd) {
      location.href = makeCwdUrl(cwd, location.href);
    },
  };
}

function copyUrlStateParam(source, target, name) {
  if (!source.has(name)) return;
  target.set(name, source.get(name) ?? "");
}

function absoluteBase(href) {
  return new URL(href || "/", "http://localhost/");
}
