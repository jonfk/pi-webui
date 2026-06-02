import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findAtFileCompletionContext,
  parseAtFilePrefix,
} from "../public/file-completion-grammar.mjs";

test("parseAtFilePrefix parses unquoted and quoted @ prefixes", () => {
  assert.deepEqual(parseAtFilePrefix("@src"), {
    rawPrefix: "src",
    isAtPrefix: true,
    isQuotedPrefix: false,
  });
  assert.deepEqual(parseAtFilePrefix('@"my folder/src'), {
    rawPrefix: "my folder/src",
    isAtPrefix: true,
    isQuotedPrefix: true,
  });
});

test("parseAtFilePrefix fails loudly for non-@ prefixes", () => {
  assert.throws(() => parseAtFilePrefix("src"), /Expected an @ file completion prefix/);
});

test("findAtFileCompletionContext mirrors Pi @ token boundary behavior", () => {
  assert.deepEqual(findAtFileCompletionContext("hello @src", "hello @src".length), {
    prefix: "@src",
    startIndex: 6,
    endIndex: 10,
    rawPrefix: "src",
    isQuoted: false,
    isAtPrefix: true,
  });

  assert.equal(findAtFileCompletionContext("foo@src", "foo@src".length), null);
});

test("findAtFileCompletionContext handles quoted and multiline @ prefixes", () => {
  const quoted = 'please inspect @"my folder/te';
  assert.deepEqual(findAtFileCompletionContext(quoted, quoted.length), {
    prefix: '@"my folder/te',
    startIndex: 15,
    endIndex: quoted.length,
    rawPrefix: "my folder/te",
    isQuoted: true,
    isAtPrefix: true,
  });

  const multiline = "first @old\nsecond @src/te";
  assert.deepEqual(findAtFileCompletionContext(multiline, multiline.length), {
    prefix: "@src/te",
    startIndex: 18,
    endIndex: multiline.length,
    rawPrefix: "src/te",
    isQuoted: false,
    isAtPrefix: true,
  });
});
