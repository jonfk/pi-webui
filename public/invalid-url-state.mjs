export function invalidUrlStateToChatItem(payload = {}) {
  const title = payload.kind === "cwd"
    ? "Could not open URL working directory"
    : "Could not open URL session";
  const text = messageText(payload);
  return {
    kind: "invalid-url-state",
    title,
    blocks: [{ type: "text", text }],
    actions: [],
  };
}

export function cwdRequiredToChatItem(payload = {}) {
  return {
    kind: "cwd-required",
    title: "Choose a working directory",
    blocks: [{ type: "text", text: messageText(payload) || "Choose a working directory to start pi-webui." }],
    actions: [],
  };
}

export function recoveryActionForInvalidUrlState(action, payload = {}) {
  throw new Error(`Unknown invalid URL recovery action: ${action}`);
}

function messageText(payload) {
  let text = typeof payload.message === "string" ? payload.message : "";
  if (typeof payload.value !== "string" || payload.value.length === 0) return text;
  if (text.includes(payload.value)) return text;
  return `${text}\n\nPath: ${payload.value}`;
}
