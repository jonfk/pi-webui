import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileCompletionSearchController } from "../dist/server/file-completion-controller.js";
import { createFileCompletionEndpoint } from "../dist/server/file-completion-endpoint.js";
import {
  buildFileCompletionSearchPlan,
  searchFileCompletions,
} from "../dist/server/file-completion.js";

const realFdPath = process.env.PATH?.split(":").find((dir) => existsSync(join(dir, "fd")));

test("fd is available for file completion tests", () => {
  assert.ok(realFdPath, "file completion tests require the fd executable on PATH");
});

function createLogger() {
  const entries = [];
  return {
    entries,
    logger: {
      error: (message, fields) => entries.push({ level: "error", message, fields }),
      warn: (message, fields) => entries.push({ level: "warn", message, fields }),
    },
  };
}

function createTempTree() {
  const root = mkdtempSync(join(tmpdir(), "pi-webui-file-completion-"));
  const cwd = join(root, "cwd");
  const home = join(root, "home");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  return {
    root,
    cwd,
    home,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function fileCompletionItem(insertText, label, description) {
  return {
    insertText,
    label,
    description,
    isDirectory: false,
    addsTrailingSpace: true,
    cursorOffset: `${insertText} `.length,
  };
}

function directoryCompletionItem(insertText, label, description) {
  return {
    insertText,
    label,
    description,
    isDirectory: true,
    addsTrailingSpace: false,
    cursorOffset: insertText.length,
  };
}

function writeTree(baseDir, entries) {
  for (const [relativePath, value] of Object.entries(entries)) {
    const fullPath = join(baseDir, relativePath);
    if (value === null) {
      mkdirSync(fullPath, { recursive: true });
    } else {
      mkdirSync(join(fullPath, ".."), { recursive: true });
      writeFileSync(fullPath, value);
    }
  }
}

async function withPath(pathValue, callback) {
  const previousPath = process.env.PATH;
  process.env.PATH = pathValue;
  try {
    return await callback();
  } finally {
    process.env.PATH = previousPath;
  }
}

test("buildFileCompletionSearchPlan expands home only for search", () => {
  const plan = buildFileCompletionSearchPlan({
    cwd: "/workspace",
    homeDir: "/home/user",
    prefix: "@~/project/src",
  });

  assert.equal(plan.baseDir, "/home/user/project/");
  assert.equal(plan.displayBase, "~/project/");
  assert.equal(plan.query, "src");
});

test("searchFileCompletions returns explicit insertion contract for files and directories", async () => {
  const tree = createTempTree();
  try {
    writeTree(tree.cwd, {
      "README.md": "readme",
      "src/index.ts": "export {};",
    });

    const items = await searchFileCompletions({
      cwd: tree.cwd,
      homeDir: tree.home,
      prefix: "@",
    });
    const fileItem = items.find((item) => item.insertText === "@README.md");
    const directoryItem = items.find((item) => item.insertText === "@src/");
    const values = items.map((item) => item.insertText);

    assert.deepEqual(fileItem, {
      insertText: "@README.md",
      label: "README.md",
      description: "README.md",
      isDirectory: false,
      addsTrailingSpace: true,
      cursorOffset: "@README.md ".length,
    });
    assert.deepEqual(directoryItem, {
      insertText: "@src/",
      label: "src/",
      description: "src",
      isDirectory: true,
      addsTrailingSpace: false,
      cursorOffset: "@src/".length,
    });
    assert.equal(values.find((value) => value === "@src//"), undefined);
  } finally {
    tree.cleanup();
  }
});

test("searchFileCompletions scopes nested relative prefixes", async () => {
  const tree = createTempTree();
  try {
    writeTree(tree.cwd, {
      "src/index.ts": "export {};",
      "src/internal/readme.md": "nested",
      "other/index.ts": "export {};",
    });

    const items = await searchFileCompletions({
      cwd: tree.cwd,
      homeDir: tree.home,
      prefix: "@src/i",
    });
    const values = items.map((item) => item.insertText);

    assert.ok(values.includes("@src/index.ts"));
    assert.ok(values.includes("@src/internal/"));
    assert.ok(!values.includes("@other/index.ts"));
  } finally {
    tree.cleanup();
  }
});

test("searchFileCompletions falls back to full-path fuzzy search for missing relative scopes", async () => {
  const tree = createTempTree();
  try {
    writeTree(tree.cwd, {
      "src/components/Button.tsx": "export {};",
      "src/utils/helpers.ts": "export {};",
    });

    const items = await searchFileCompletions({
      cwd: tree.cwd,
      homeDir: tree.home,
      prefix: "@components/",
    });
    const values = items.map((item) => item.insertText);

    assert.ok(values.includes("@src/components/Button.tsx"));
    assert.ok(!values.includes("@src/utils/helpers.ts"));
  } finally {
    tree.cleanup();
  }
});

test("searchFileCompletions matches deep slash queries from cwd when the scope does not exist", async () => {
  const tree = createTempTree();
  try {
    writeTree(tree.cwd, {
      "packages/tui/src/autocomplete.ts": "export {};",
      "packages/ai/src/autocomplete.ts": "export {};",
    });

    const items = await searchFileCompletions({
      cwd: tree.cwd,
      homeDir: tree.home,
      prefix: "@tui/src/auto",
    });
    const values = items.map((item) => item.insertText);

    assert.ok(values.includes("@packages/tui/src/autocomplete.ts"));
    assert.ok(!values.includes("@packages/ai/src/autocomplete.ts"));
  } finally {
    tree.cleanup();
  }
});

test("searchFileCompletions treats regex metacharacters as literal filename text", async () => {
  const tree = createTempTree();
  try {
    writeTree(tree.cwd, {
      "[draft].md": "bracket",
      "(notes).md": "paren",
      "foo.bar": "dot",
      "fooXbar": "x",
    });

    const bracketItems = await searchFileCompletions({
      cwd: tree.cwd,
      homeDir: tree.home,
      prefix: "@[",
    });
    const parenItems = await searchFileCompletions({
      cwd: tree.cwd,
      homeDir: tree.home,
      prefix: "@(",
    });
    const dotItems = await searchFileCompletions({
      cwd: tree.cwd,
      homeDir: tree.home,
      prefix: "@foo.",
    });

    assert.ok(bracketItems.some((item) => item.insertText === "@[draft].md"));
    assert.ok(parenItems.some((item) => item.insertText === "@(notes).md"));
    assert.ok(dotItems.some((item) => item.insertText === "@foo.bar"));
    assert.ok(!dotItems.some((item) => item.insertText === "@fooXbar"));
  } finally {
    tree.cleanup();
  }
});

test("searchFileCompletions treats leading dash queries as filename text", async () => {
  const tree = createTempTree();
  try {
    writeTree(tree.cwd, {
      "-dash.txt": "dash",
      "other.txt": "other",
    });

    const items = await searchFileCompletions({
      cwd: tree.cwd,
      homeDir: tree.home,
      prefix: "@-d",
    });

    assert.ok(items.some((item) => item.insertText === "@-dash.txt"));
  } finally {
    tree.cleanup();
  }
});

test("searchFileCompletions treats regex metacharacters as literal scoped path text", async () => {
  const tree = createTempTree();
  try {
    writeTree(tree.cwd, {
      "src/[draft].md": "bracket",
      "src/(notes).md": "paren",
      "src/foo.bar": "dot",
      "src/fooXbar": "x",
    });

    const bracketItems = await searchFileCompletions({
      cwd: tree.cwd,
      homeDir: tree.home,
      prefix: "@src/[",
    });
    const parenItems = await searchFileCompletions({
      cwd: tree.cwd,
      homeDir: tree.home,
      prefix: "@src/(",
    });
    const dotItems = await searchFileCompletions({
      cwd: tree.cwd,
      homeDir: tree.home,
      prefix: "@src/foo.",
    });

    assert.ok(bracketItems.some((item) => item.insertText === "@src/[draft].md"));
    assert.ok(parenItems.some((item) => item.insertText === "@src/(notes).md"));
    assert.ok(dotItems.some((item) => item.insertText === "@src/foo.bar"));
    assert.ok(!dotItems.some((item) => item.insertText === "@src/fooXbar"));
  } finally {
    tree.cleanup();
  }
});

test("searchFileCompletions preserves parent-relative prefixes", async () => {
  const tree = createTempTree();
  try {
    const sibling = join(tree.root, "sibling");
    mkdirSync(sibling, { recursive: true });
    writeTree(sibling, {
      "nested/alpha.ts": "export {};",
      "nested/zzz.ts": "export {};",
    });

    const items = await searchFileCompletions({
      cwd: tree.cwd,
      homeDir: tree.home,
      prefix: "@../sibling/a",
    });
    const values = items.map((item) => item.insertText);

    assert.ok(values.includes("@../sibling/nested/alpha.ts"));
    assert.ok(!values.includes("@../sibling/nested/zzz.ts"));
  } finally {
    tree.cleanup();
  }
});

test("searchFileCompletions preserves absolute prefixes", async () => {
  const tree = createTempTree();
  try {
    writeTree(tree.cwd, {
      "README.md": "readme",
    });

    const items = await searchFileCompletions({
      cwd: tree.cwd,
      homeDir: tree.home,
      prefix: `@${tree.cwd}/REA`,
    });

    assert.ok(items.some((item) => item.insertText === `@${tree.cwd}/README.md`));
  } finally {
    tree.cleanup();
  }
});

test("searchFileCompletions searches home-relative prefixes but returns user-visible home paths", async () => {
  const tree = createTempTree();
  try {
    writeTree(tree.home, {
      "project/alpha.ts": "export {};",
    });

    const items = await searchFileCompletions({
      cwd: tree.cwd,
      homeDir: tree.home,
      prefix: "@~/project/a",
    });

    assert.ok(items.some((item) => item.insertText === "@~/project/alpha.ts"));
  } finally {
    tree.cleanup();
  }
});

test("searchFileCompletions quotes paths with spaces", async () => {
  const tree = createTempTree();
  try {
    writeTree(tree.cwd, {
      "my folder/space file.txt": "content",
      "my folder/templates/index.ts": "export {};",
    });

    const fileItems = await searchFileCompletions({
      cwd: tree.cwd,
      homeDir: tree.home,
      prefix: '@"my folder/s',
    });
    const directoryItems = await searchFileCompletions({
      cwd: tree.cwd,
      homeDir: tree.home,
      prefix: '@"my folder/t',
    });

    assert.deepEqual(
      fileItems.find((item) => item.insertText === '@"my folder/space file.txt"'),
      {
        insertText: '@"my folder/space file.txt"',
        label: "space file.txt",
        description: "my folder/space file.txt",
        isDirectory: false,
        addsTrailingSpace: true,
        cursorOffset: '@"my folder/space file.txt" '.length,
        replaceFollowingText: '"',
      },
    );
    assert.deepEqual(
      directoryItems.find((item) => item.insertText === '@"my folder/templates/"'),
      {
        insertText: '@"my folder/templates/"',
        label: "templates/",
        description: "my folder/templates",
        isDirectory: true,
        addsTrailingSpace: false,
        cursorOffset: '@"my folder/templates/'.length,
        replaceFollowingText: '"',
      },
    );
  } finally {
    tree.cleanup();
  }
});

test("searchFileCompletions includes hidden paths and excludes .git", async () => {
  const tree = createTempTree();
  try {
    writeTree(tree.cwd, {
      ".pi/config.json": "{}",
      ".github/workflows/ci.yml": "name: ci",
      ".git/config": "[core]",
    });

    const items = await searchFileCompletions({
      cwd: tree.cwd,
      homeDir: tree.home,
      prefix: "@",
    });
    const values = items.map((item) => item.insertText);

    assert.ok(values.includes("@.pi/"));
    assert.ok(values.includes("@.github/"));
    assert.ok(!values.some((value) => value === "@.git" || value.startsWith("@.git/")));
  } finally {
    tree.cleanup();
  }
});

test("searchFileCompletions follows symlinked directories", async () => {
  const tree = createTempTree();
  try {
    const outside = join(tree.root, "outside");
    mkdirSync(outside, { recursive: true });
    writeTree(outside, {
      "some_file.txt": "content",
    });
    symlinkSync("../outside", join(tree.cwd, "symlinked_dir"));

    const items = await searchFileCompletions({
      cwd: tree.cwd,
      homeDir: tree.home,
      prefix: "@some",
    });
    const values = items.map((item) => item.insertText);

    assert.ok(values.includes("@symlinked_dir/some_file.txt"));
  } finally {
    tree.cleanup();
  }
});

test("searchFileCompletions trusts fd trailing slashes for directory results", async () => {
  const tree = createTempTree();
  const fakePath = join(tree.root, "fake-path");
  mkdirSync(fakePath);
  const fakeFd = join(fakePath, "fd");
  writeFileSync(fakeFd, "#!/bin/sh\nprintf 'src/\\nREADME.md\\ngone/\\n.git/\\n.git/config\\n'\n");
  chmodSync(fakeFd, 0o755);

  try {
    writeTree(tree.cwd, {
      "src/index.ts": "export {};",
      "README.md": "readme",
    });

    await withPath(fakePath, async () => {
      const items = await searchFileCompletions({
        cwd: tree.cwd,
        homeDir: tree.home,
        prefix: "@",
      });
      const values = items.map((item) => item.insertText);

      assert.ok(values.includes("@src/"));
      assert.ok(values.includes("@README.md"));
      assert.ok(values.includes("@gone/"));
      assert.ok(!values.some((value) => value === "@.git/" || value.startsWith("@.git/")));
    });
  } finally {
    tree.cleanup();
  }
});

test("searchFileCompletions logs and returns empty items when fd is missing", async () => {
  const tree = createTempTree();
  const emptyPath = join(tree.root, "empty-path");
  mkdirSync(emptyPath);
  const { logger, entries } = createLogger();

  try {
    await withPath(emptyPath, async () => {
      const items = await searchFileCompletions({
        cwd: tree.cwd,
        homeDir: tree.home,
        prefix: "@",
        logger,
      });
      assert.deepEqual(items, []);
    });
    assert.ok(entries.some((entry) => entry.message === "file completion fd executable not found"));
  } finally {
    tree.cleanup();
  }
});

test("searchFileCompletions times out slow fd searches", async () => {
  const tree = createTempTree();
  const fakePath = join(tree.root, "fake-path");
  mkdirSync(fakePath);
  const fakeFd = join(fakePath, "fd");
  writeFileSync(fakeFd, "#!/bin/sh\nsleep 5\n");
  chmodSync(fakeFd, 0o755);
  const { logger, entries } = createLogger();

  try {
    await withPath(fakePath, async () => {
      const items = await searchFileCompletions({
        cwd: tree.cwd,
        homeDir: tree.home,
        prefix: "@",
        timeoutMs: 20,
        logger,
      });
      assert.deepEqual(items, []);
    });
    assert.ok(entries.some((entry) => entry.message === "file completion fd search timed out"));
  } finally {
    tree.cleanup();
  }
});

test("FileCompletionSearchController emits only the latest active request", async () => {
  const emitted = [];
  const pending = new Map();
  const controller = new FileCompletionSearchController({
    search: ({ requestId, prefix, signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      pending.set(requestId, { prefix, resolve });
    }),
    emit: (packet) => emitted.push(packet),
    isOpen: () => true,
    logger: createLogger().logger,
  });

  controller.request({ requestId: "req-1", prefix: "@a" });
  controller.request({ requestId: "req-2", prefix: "@b" });
  pending.get("req-1")?.resolve([fileCompletionItem("@a.txt", "a.txt", "a.txt")]);
  pending.get("req-2")?.resolve([fileCompletionItem("@b.txt", "b.txt", "b.txt")]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(emitted.map((packet) => packet.payload.requestId), ["req-2"]);
});

test("FileCompletionSearchController suppresses results after close", async () => {
  const emitted = [];
  let resolveSearch;
  const controller = new FileCompletionSearchController({
    search: ({ signal }) => new Promise((resolve, reject) => {
      resolveSearch = resolve;
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
    emit: (packet) => emitted.push(packet),
    isOpen: () => true,
    logger: createLogger().logger,
  });

  controller.request({ requestId: "req-1", prefix: "@" });
  controller.close();
  resolveSearch([fileCompletionItem("@a.txt", "a.txt", "a.txt")]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(emitted, []);
});

test("FileCompletionEndpoint searches with the current runtime context", async () => {
  const emitted = [];
  const seenRequests = [];
  const endpoint = createFileCompletionEndpoint({
    getSearchContext: () => ({ cwd: "/workspace", homeDir: "/home/user" }),
    send: (packet) => emitted.push(packet),
    isOpen: () => true,
    logger: createLogger().logger,
    search: async (request) => {
      seenRequests.push(request);
      return [directoryCompletionItem("@src/", "src/", "@src")];
    },
  });

  assert.equal(endpoint.handle({ type: "file_completion_request", requestId: "req-1", prefix: "@s" }), true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(seenRequests.length, 1);
  assert.equal(seenRequests[0].cwd, "/workspace");
  assert.equal(seenRequests[0].homeDir, "/home/user");
  assert.equal(seenRequests[0].prefix, "@s");
  assert.deepEqual(emitted, [{
    type: "file_completion_result",
    payload: {
      requestId: "req-1",
      prefix: "@s",
      items: [directoryCompletionItem("@src/", "src/", "@src")],
    },
  }]);
});

test("FileCompletionEndpoint emits an empty result when no runtime context exists", () => {
  const emitted = [];
  const endpoint = createFileCompletionEndpoint({
    getSearchContext: () => null,
    send: (packet) => emitted.push(packet),
    isOpen: () => true,
    logger: createLogger().logger,
    search: async () => {
      throw new Error("search should not run without a runtime context");
    },
  });

  assert.equal(endpoint.handle({ type: "file_completion_request", requestId: "req-1", prefix: "@s" }), true);

  assert.deepEqual(emitted, [{
    type: "file_completion_result",
    payload: { requestId: "req-1", prefix: "@s", items: [] },
  }]);
});

test("FileCompletionEndpoint fails loudly on malformed request packets", () => {
  const endpoint = createFileCompletionEndpoint({
    getSearchContext: () => ({ cwd: "/workspace", homeDir: "/home/user" }),
    send: () => {},
    isOpen: () => true,
    logger: createLogger().logger,
    search: async () => [],
  });

  assert.throws(
    () => endpoint.handle({ type: "file_completion_request", requestId: "", prefix: "@s" }),
    /requestId must be a non-empty string/,
  );
  assert.throws(
    () => endpoint.handle({ type: "file_completion_request", requestId: "req-1", prefix: "s" }),
    /prefix must be an @ file completion prefix/,
  );
  assert.throws(
    () => endpoint.handle({ type: "file_completion_cancel", requestId: "" }),
    /requestId must be a non-empty string/,
  );
});

test("FileCompletionEndpoint suppresses replaced request results", async () => {
  const emitted = [];
  const pending = new Map();
  const aborted = [];
  const endpoint = createFileCompletionEndpoint({
    getSearchContext: () => ({ cwd: "/workspace", homeDir: "/home/user" }),
    send: (packet) => emitted.push(packet),
    isOpen: () => true,
    logger: createLogger().logger,
    search: ({ requestId, prefix, signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted.push(requestId);
        reject(new Error("aborted"));
      }, { once: true });
      pending.set(requestId, { prefix, resolve });
    }),
  });

  endpoint.handle({ type: "file_completion_request", requestId: "req-1", prefix: "@a" });
  endpoint.handle({ type: "file_completion_request", requestId: "req-2", prefix: "@b" });
  pending.get("req-1")?.resolve([fileCompletionItem("@a.txt", "a.txt", "a.txt")]);
  pending.get("req-2")?.resolve([fileCompletionItem("@b.txt", "b.txt", "b.txt")]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(aborted, ["req-1"]);
  assert.deepEqual(emitted.map((packet) => packet.payload.requestId), ["req-2"]);
});

test("FileCompletionEndpoint aborts a client-cancelled active request", async () => {
  const emitted = [];
  const aborted = [];
  let resolveSearch;
  const endpoint = createFileCompletionEndpoint({
    getSearchContext: () => ({ cwd: "/workspace", homeDir: "/home/user" }),
    send: (packet) => emitted.push(packet),
    isOpen: () => true,
    logger: createLogger().logger,
    search: ({ requestId, signal }) => new Promise((resolve, reject) => {
      resolveSearch = resolve;
      signal.addEventListener("abort", () => {
        aborted.push(requestId);
        reject(new Error("aborted"));
      }, { once: true });
    }),
  });

  endpoint.handle({ type: "file_completion_request", requestId: "req-1", prefix: "@a" });
  assert.equal(endpoint.handle({ type: "file_completion_cancel", requestId: "req-1" }), true);
  resolveSearch([fileCompletionItem("@a.txt", "a.txt", "a.txt")]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(aborted, ["req-1"]);
  assert.deepEqual(emitted, []);
});

test("FileCompletionEndpoint ignores cancels for inactive request ids", async () => {
  const emitted = [];
  let resolveSearch;
  const endpoint = createFileCompletionEndpoint({
    getSearchContext: () => ({ cwd: "/workspace", homeDir: "/home/user" }),
    send: (packet) => emitted.push(packet),
    isOpen: () => true,
    logger: createLogger().logger,
    search: ({ signal }) => new Promise((resolve, reject) => {
      resolveSearch = resolve;
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });

  endpoint.handle({ type: "file_completion_request", requestId: "req-1", prefix: "@a" });
  assert.equal(endpoint.handle({ type: "file_completion_cancel", requestId: "other" }), true);
  resolveSearch([fileCompletionItem("@a.txt", "a.txt", "a.txt")]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(emitted.map((packet) => packet.payload.requestId), ["req-1"]);
});

test("FileCompletionEndpoint aborts runtime work without emitting stale results", async () => {
  const emitted = [];
  let resolveSearch;
  const endpoint = createFileCompletionEndpoint({
    getSearchContext: () => ({ cwd: "/workspace", homeDir: "/home/user" }),
    send: (packet) => emitted.push(packet),
    isOpen: () => true,
    logger: createLogger().logger,
    search: ({ signal }) => new Promise((resolve, reject) => {
      resolveSearch = resolve;
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });

  endpoint.handle({ type: "file_completion_request", requestId: "req-1", prefix: "@a" });
  endpoint.abortRuntimeWork();
  resolveSearch([fileCompletionItem("@a.txt", "a.txt", "a.txt")]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(emitted, []);
});
