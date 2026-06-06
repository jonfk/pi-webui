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
  let cwdPointerPromptSent = false;
  let pendingCommand = null;
  let latestSessionFile = null;
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

    canonicalizeCwdPointer(cwd) {
      const state = this.current();
      if (state.kind === "new") {
        replace(makeCwdUrl(cwd, location.href));
        return;
      }
      if (state.kind === "cwd" && state.cwd !== cwd) {
        replace(makeCwdUrl(cwd, location.href));
      }
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
      if (options.allowFromCwdPointer) {
        push(makeSessionUrl(sessionFile, location.href));
      }
    },

    markCwdPointerPromptSent() {
      cwdPointerPromptSent = true;
    },

    promoteAcceptedCwdPointerPrompt(sessionFile) {
      if (!cwdPointerPromptSent || !sessionFile) return;
      const state = this.current();
      if (state.kind !== "new" && state.kind !== "cwd") return;
      cwdPointerPromptSent = false;
      replace(makeSessionUrl(sessionFile, location.href));
    },

    syncCwdPointer(cwd) {
      if (!cwd) return;
      const state = this.current();
      if (state.kind === "cwd" && state.cwd === cwd) return;
      push(makeCwdUrl(cwd, location.href));
    },

    observeCommandStarted(command) {
      if (command === "prompt") {
        this.markCwdPointerPromptSent();
        return;
      }

      pendingCommand = command;
    },

    observeSessionState(sessionState) {
      latestSessionFile = sessionState?.sessionFile || null;
      if (pendingCommand) return;
      this.syncDurableSession(latestSessionFile);
    },

    observeCommandSucceeded(command, data, effects = []) {
      if (command === "prompt") {
        this.promoteAcceptedCwdPointerPrompt(latestSessionFile);
        cwdPointerPromptSent = false;
        return;
      }

      consumePendingCommand(command);
      for (const effect of effects) {
        if (effect?.type !== "runtime_target_changed") continue;
        this.applyRuntimeTargetChangedEffect(effect);
      }
    },

    observeCommandFailed(command) {
      if (command === "prompt") cwdPointerPromptSent = false;
      consumePendingCommand(command);
    },

    applyRuntimeTargetChangedEffect(effect) {
      const target = effect?.target;
      if (target?.kind === "cwd") {
        if (typeof target.cwd !== "string") throw new Error("runtime_target_changed cwd effect is missing cwd");
        this.syncCwdPointer(target.cwd);
        return;
      }
      if (target?.kind === "session") {
        if (typeof target.sessionPath !== "string") {
          throw new Error("runtime_target_changed session effect is missing sessionPath");
        }
        if (typeof target.cwd !== "string") throw new Error("runtime_target_changed session effect is missing cwd");
        const state = this.current();
        if (state.kind === "session" && state.sessionFile === target.sessionPath) return;
        push(makeSessionUrl(target.sessionPath, location.href));
        return;
      }
      throw new Error("runtime_target_changed effect has an unknown target kind");
    },

    navigateToSession(sessionFile) {
      location.href = makeSessionUrl(sessionFile, location.href);
    },

    navigateToCwd(cwd) {
      location.href = makeCwdUrl(cwd, location.href);
    },
  };

  function consumePendingCommand(command) {
    if (pendingCommand !== command) return;
    pendingCommand = null;
  }
}

function copyUrlStateParam(source, target, name) {
  if (!source.has(name)) return;
  target.set(name, source.get(name) ?? "");
}

function absoluteBase(href) {
  return new URL(href || "/", "http://localhost/");
}
