import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import {
  applyAtCompletion,
  createFileCompletionController,
  findAtCompletionContext,
} from "../public/file-completion-controller.mjs";

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.children = [];
    this.hidden = false;
    this.className = "";
    this.dataset = {};
    this.textContent = "";
    this.listeners = {};
  }

  append(...children) {
    this.children.push(...children);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  scrollIntoView() {}
}

class FakeInput {
  constructor(value = "") {
    this.value = value;
    this.selectionStart = value.length;
    this.selectionEnd = value.length;
    this.focused = false;
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  focus() {
    this.focused = true;
  }
}

function withFakeDocument(fn) {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    return fn();
  } finally {
    globalThis.document = originalDocument;
  }
}

function createKeyEvent(key, options = {}) {
  return {
    key,
    shiftKey: Boolean(options.shiftKey),
    isComposing: Boolean(options.isComposing),
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

const FILE_ITEM = {
  insertText: "@src/server/index.ts",
  label: "index.ts",
  description: "src/server/index.ts",
  isDirectory: false,
  addsTrailingSpace: true,
  cursorOffset: "@src/server/index.ts ".length,
};

const DIR_ITEM = {
  insertText: "@src/server/",
  label: "server/",
  description: "src/server",
  isDirectory: true,
  addsTrailingSpace: false,
  cursorOffset: "@src/server/".length,
};

test("findAtCompletionContext detects @ paths at valid token starts", () => {
  assert.deepEqual(findAtCompletionContext("hello @src", "hello @src".length), {
    prefix: "@src",
    startIndex: 6,
    endIndex: 10,
    rawPrefix: "src",
    isQuoted: false,
    isAtPrefix: true,
  });

  assert.equal(findAtCompletionContext("foo@src", "foo@src".length), null);
  assert.equal(findAtCompletionContext("hello @src", 6, 10), null);
});

test("findAtCompletionContext handles quoted and multiline prefixes", () => {
  const quoted = 'please inspect @"my folder/te';
  assert.deepEqual(findAtCompletionContext(quoted, quoted.length), {
    prefix: '@"my folder/te',
    startIndex: 15,
    endIndex: quoted.length,
    rawPrefix: "my folder/te",
    isQuoted: true,
    isAtPrefix: true,
  });

  const multiline = "first @old\nsecond @src/te";
  assert.deepEqual(findAtCompletionContext(multiline, multiline.length), {
    prefix: "@src/te",
    startIndex: 18,
    endIndex: multiline.length,
    rawPrefix: "src/te",
    isQuoted: false,
    isAtPrefix: true,
  });
});

test("applyAtCompletion adds file spaces and leaves directory prefixes open", () => {
  const text = "read @src";
  const context = findAtCompletionContext(text, text.length);

  assert.deepEqual(applyAtCompletion(text, text.length, context, FILE_ITEM), {
    text: "read @src/server/index.ts ",
    cursorIndex: "read @src/server/index.ts ".length,
  });

  assert.deepEqual(applyAtCompletion(text, text.length, context, DIR_ITEM), {
    text: "read @src/server/",
    cursorIndex: "read @src/server/".length,
  });
});

test("applyAtCompletion does not duplicate an existing closing quote", () => {
  const text = 'read @"my folder/te" please';
  const cursorIndex = 'read @"my folder/te'.length;
  const context = findAtCompletionContext(text, cursorIndex);
  const item = {
    insertText: '@"my folder/templates/"',
    label: "templates/",
    description: "my folder/templates",
    isDirectory: true,
    addsTrailingSpace: false,
    cursorOffset: '@"my folder/templates/'.length,
    replaceFollowingText: '"',
  };

  assert.deepEqual(applyAtCompletion(text, cursorIndex, context, item), {
    text: 'read @"my folder/templates/" please',
    cursorIndex: 'read @"my folder/templates/'.length,
  });
});

test("controller sends one debounced request for the current prefix", async () => {
  const input = new FakeInput("hello @src");
  const menu = new FakeElement();
  menu.hidden = true;
  const sent = [];
  const controller = createFileCompletionController({
    input,
    menu,
    debounceMs: 5,
    sendRequest: (packet) => sent.push(packet),
  });

  controller.onInputChanged();
  input.value = "hello @src/server";
  input.setSelectionRange(input.value.length, input.value.length);
  controller.onInputChanged();

  await delay(20);

  assert.deepEqual(sent, [{
    type: "file_completion_request",
    requestId: "file-2",
    prefix: "@src/server",
  }]);
});

test("controller close clears unsent debounce without sending a cancel packet", async () => {
  const input = new FakeInput("hello @src");
  const menu = new FakeElement();
  menu.hidden = true;
  const sent = [];
  const controller = createFileCompletionController({
    input,
    menu,
    debounceMs: 20,
    sendRequest: (packet) => sent.push(packet),
  });

  controller.onInputChanged();
  controller.close("blur");
  await delay(30);

  assert.deepEqual(sent, []);
});

test("controller close cancels a request after it has been sent", async () => {
  const input = new FakeInput("hello @src");
  const menu = new FakeElement();
  menu.hidden = true;
  const sent = [];
  const controller = createFileCompletionController({
    input,
    menu,
    debounceMs: 5,
    sendRequest: (packet) => sent.push(packet),
  });

  controller.onInputChanged();
  await delay(20);
  controller.close("blur");

  assert.deepEqual(sent, [
    { type: "file_completion_request", requestId: "file-1", prefix: "@src" },
    { type: "file_completion_cancel", requestId: "file-1" },
  ]);
});

test("controller ignores stale and outdated result packets", () => withFakeDocument(() => {
  const input = new FakeInput("hello @src");
  const menu = new FakeElement();
  menu.hidden = true;
  const controller = createFileCompletionController({
    input,
    menu,
    debounceMs: 100,
    sendRequest: () => {},
  });

  controller.onInputChanged();
  controller.handleResult({ requestId: "stale", prefix: "@src", items: [FILE_ITEM] });
  assert.equal(menu.hidden, true);

  input.value = "hello @src/server";
  input.setSelectionRange(input.value.length, input.value.length);
  controller.handleResult({ requestId: "file-1", prefix: "@src", items: [FILE_ITEM] });
  assert.equal(menu.hidden, true);
}));

test("controller renders results and applies Tab without submitting elsewhere", () => withFakeDocument(() => {
  const input = new FakeInput("hello @src");
  const menu = new FakeElement();
  menu.hidden = true;
  let applied = 0;
  const controller = createFileCompletionController({
    input,
    menu,
    debounceMs: 100,
    sendRequest: () => {},
    onApply: () => { applied += 1; },
  });

  controller.onInputChanged();
  controller.handleResult({ requestId: "file-1", prefix: "@src", items: [FILE_ITEM] });

  assert.equal(menu.hidden, false);
  assert.equal(menu.children.length, 1);
  assert.equal(menu.children[0].children[0].textContent, "index.ts");

  const event = createKeyEvent("Tab");
  assert.equal(controller.handleKeydown(event), true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(input.value, "hello @src/server/index.ts ");
  assert.equal(input.selectionStart, input.value.length);
  assert.equal(menu.hidden, true);
  assert.equal(applied, 1);
}));

test("controller applies Enter for quoted directories with cursor before closing quote", () => withFakeDocument(() => {
  const input = new FakeInput('hello @"my folder/te');
  const menu = new FakeElement();
  menu.hidden = true;
  const controller = createFileCompletionController({
    input,
    menu,
    debounceMs: 100,
    sendRequest: () => {},
  });
  const item = {
    insertText: '@"my folder/templates/"',
    label: "templates/",
    description: "my folder/templates",
    isDirectory: true,
    addsTrailingSpace: false,
    cursorOffset: '@"my folder/templates/'.length,
    replaceFollowingText: '"',
  };

  controller.onInputChanged();
  controller.handleResult({ requestId: "file-1", prefix: '@"my folder/te', items: [item] });

  const event = createKeyEvent("Enter");
  assert.equal(controller.handleKeydown(event), true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(input.value, 'hello @"my folder/templates/"');
  assert.equal(input.selectionStart, 'hello @"my folder/templates/'.length);
}));

test("Escape closes only the file completion menu", () => withFakeDocument(() => {
  const input = new FakeInput("hello @src");
  const menu = new FakeElement();
  menu.hidden = true;
  const controller = createFileCompletionController({
    input,
    menu,
    debounceMs: 100,
    sendRequest: () => {},
  });

  controller.onInputChanged();
  controller.handleResult({ requestId: "file-1", prefix: "@src", items: [FILE_ITEM] });

  const event = createKeyEvent("Escape");
  assert.equal(controller.handleKeydown(event), true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(menu.hidden, true);
}));

test("controller ignores results after Escape closes an in-flight request", () => withFakeDocument(() => {
  const input = new FakeInput("hello @src");
  const menu = new FakeElement();
  menu.hidden = true;
  const controller = createFileCompletionController({
    input,
    menu,
    debounceMs: 100,
    sendRequest: () => {},
  });

  controller.onInputChanged();
  controller.close("escape");
  controller.handleResult({ requestId: "file-1", prefix: "@src", items: [FILE_ITEM] });

  assert.equal(menu.hidden, true);
  assert.equal(menu.children.length, 0);
}));

test("controller ignores results after blur closes an in-flight request", () => withFakeDocument(() => {
  const input = new FakeInput("hello @src");
  const menu = new FakeElement();
  menu.hidden = true;
  const controller = createFileCompletionController({
    input,
    menu,
    debounceMs: 100,
    sendRequest: () => {},
  });

  controller.onInputChanged();
  controller.close("blur");
  controller.handleResult({ requestId: "file-1", prefix: "@src", items: [FILE_ITEM] });

  assert.equal(menu.hidden, true);
  assert.equal(menu.children.length, 0);
}));

test("controller ignores results after history closes an in-flight request", () => withFakeDocument(() => {
  const input = new FakeInput("hello @src");
  const menu = new FakeElement();
  menu.hidden = true;
  const controller = createFileCompletionController({
    input,
    menu,
    debounceMs: 100,
    sendRequest: () => {},
  });

  controller.onInputChanged();
  controller.close("history");
  controller.handleResult({ requestId: "file-1", prefix: "@src", items: [FILE_ITEM] });

  assert.equal(menu.hidden, true);
  assert.equal(menu.children.length, 0);
}));

test("cursor changes close an open menu when the @ context is gone", () => withFakeDocument(() => {
  const input = new FakeInput("hello @src");
  const menu = new FakeElement();
  menu.hidden = true;
  const controller = createFileCompletionController({
    input,
    menu,
    debounceMs: 100,
    sendRequest: () => {},
  });

  controller.onInputChanged();
  controller.handleResult({ requestId: "file-1", prefix: "@src", items: [FILE_ITEM] });
  assert.equal(menu.hidden, false);

  input.setSelectionRange(0, 0);
  controller.onCursorChanged();
  assert.equal(menu.hidden, true);
}));
