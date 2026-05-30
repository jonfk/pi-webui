import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cwdRequiredToChatItem,
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
    { id: "choose-cwd", label: "Choose cwd" },
    { id: "choose-session", label: "Choose session" },
  ]);
});

test("cwdRequiredToChatItem renders a blocked-startup message", () => {
  const item = cwdRequiredToChatItem({
    message: "Saved working directory is unavailable",
    value: "/tmp/deleted",
  });
  assert.equal(item.title, "Choose a working directory");
  assert.equal(item.blocks[0].text, "Saved working directory is unavailable\n\nPath: /tmp/deleted");
  assert.deepEqual(item.actions, [
    { id: "choose-cwd", label: "Choose cwd" },
    { id: "choose-session", label: "Choose session" },
  ]);
});

test("recoveryActionForInvalidUrlState maps and rejects recovery actions", () => {
  assert.deepEqual(recoveryActionForInvalidUrlState("choose-cwd", {}), {
    kind: "request",
    request: "list_recent_cwds",
  });
  assert.deepEqual(recoveryActionForInvalidUrlState("choose-session", {}), {
    kind: "request",
    request: "list_all_sessions",
  });
  assert.throws(() => recoveryActionForInvalidUrlState("new-session", {}), /Unknown recovery action/);
});
