export function invalidUrlStateToChatItem(payload = {}) {
  const title = payload.kind === "cwd"
    ? "Could not open URL working directory"
    : "Could not open URL session";
  const text = messageText(payload);
  return {
    kind: "invalid-url-state",
    title,
    blocks: [{ type: "text", text }],
    actions: [
      { id: "new-session", label: "New session" },
      { id: "choose-session", label: "Choose session" },
    ],
  };
}

export function recoveryActionForInvalidUrlState(action, payload = {}) {
  if (action === "new-session") {
    return { kind: "navigate-cwd", cwd: payload.defaultCwd };
  }
  if (action === "choose-session") {
    return { kind: "choose-session", sessions: payload.sessions };
  }
  throw new Error(`Unknown invalid URL recovery action: ${action}`);
}

function messageText(payload) {
  let text = typeof payload.message === "string" ? payload.message : "";
  if (typeof payload.value !== "string" || payload.value.length === 0) return text;
  if (text.includes(payload.value)) return text;
  return `${text}\n\nPath: ${payload.value}`;
}
