import { test } from "node:test";
import assert from "node:assert/strict";
import {
  invalidUrlStateToChatItem,
  recoveryActionForInvalidUrlState,
} from "../public/invalid-url-state.mjs";

test("invalidUrlStateToChatItem selects cwd and session titles", () => {
  assert.equal(invalidUrlStateToChatItem({ kind: "cwd" }).title, "Could not open URL working directory");
  assert.equal(invalidUrlStateToChatItem({ kind: "session" }).title, "Could not open URL session");
  assert.equal(invalidUrlStateToChatItem({ kind: "conflict" }).title, "Could not open URL session");
});

test("invalidUrlStateToChatItem uses message text and appends a missing path", () => {
  const item = invalidUrlStateToChatItem({
    kind: "session",
    message: "Could not open URL session: path does not exist",
    value: "/tmp/missing.jsonl",
  });
  assert.equal(item.blocks[0].text, "Could not open URL session: path does not exist\n\nPath: /tmp/missing.jsonl");

  const alreadyIncluded = invalidUrlStateToChatItem({
    kind: "session",
    message: "Missing /tmp/missing.jsonl",
    value: "/tmp/missing.jsonl",
  });
  assert.equal(alreadyIncluded.blocks[0].text, "Missing /tmp/missing.jsonl");
});

test("invalidUrlStateToChatItem exposes explicit recovery actions", () => {
  const item = invalidUrlStateToChatItem({ kind: "session", message: "bad" });
  assert.deepEqual(item.actions, [
    { id: "new-session", label: "New session" },
    { id: "choose-session", label: "Choose session" },
  ]);
});

test("recoveryActionForInvalidUrlState maps actions to navigation decisions", () => {
  const sessions = { currentProject: [], allProjects: [] };
  const payload = { defaultCwd: "/work", sessions };
  assert.deepEqual(recoveryActionForInvalidUrlState("new-session", payload), {
    kind: "navigate-cwd",
    cwd: "/work",
  });
  assert.deepEqual(recoveryActionForInvalidUrlState("choose-session", payload), {
    kind: "choose-session",
    sessions,
  });
});

test("recoveryActionForInvalidUrlState preserves empty session lists", () => {
  const payload = { defaultCwd: "/work", sessions: { currentProject: [], allProjects: [] } };
  assert.deepEqual(recoveryActionForInvalidUrlState("choose-session", payload).sessions, payload.sessions);
});
