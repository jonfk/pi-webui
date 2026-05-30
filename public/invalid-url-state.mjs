export function invalidUrlStateToChatItem(payload = {}) {
  const title = payload.kind === "cwd"
    ? "Could not open URL working directory"
    : "Could not open URL session";
  const text = messageText(payload);
  return {
    kind: "invalid-url-state",
    title,
    blocks: [{ type: "text", text }],
    actions: recoveryActions(),
  };
}

export function cwdRequiredToChatItem(payload = {}) {
  return {
    kind: "cwd-required",
    title: "Choose a working directory",
    blocks: [{ type: "text", text: messageText(payload) || "Choose a working directory to start pi-webui." }],
    actions: recoveryActions(),
  };
}

export function recoveryActionForInvalidUrlState(action, payload = {}) {
  if (action === "choose-cwd") return { kind: "request", request: "list_recent_cwds" };
  if (action === "choose-session") return { kind: "request", request: "list_all_sessions" };
  throw new Error(`Unknown recovery action: ${action}`);
}

function recoveryActions() {
  return [
    { id: "choose-cwd", label: "Choose cwd" },
    { id: "choose-session", label: "Choose session" },
  ];
}

function messageText(payload) {
  let text = typeof payload.message === "string" ? payload.message : "";
  if (typeof payload.value !== "string" || payload.value.length === 0) return text;
  if (text.includes(payload.value)) return text;
  return `${text}\n\nPath: ${payload.value}`;
}
