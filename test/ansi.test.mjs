import { test } from "node:test";
import assert from "node:assert/strict";
import { ansiToHtml } from "../public/ansi.mjs";

test("plain text passes through with HTML escaping", () => {
  assert.equal(ansiToHtml("hello & <world>"), "hello &amp; &lt;world&gt;");
});

test("empty input returns empty string", () => {
  assert.equal(ansiToHtml(""), "");
  assert.equal(ansiToHtml(null), "");
});

test("standard 30-37 foreground emits a coloured span", () => {
  const out = ansiToHtml("\x1b[31mred\x1b[0m");
  assert.match(out, /<span style="color:#cd0000">red<\/span>/);
});

test("bold attribute applied alongside text", () => {
  const out = ansiToHtml("\x1b[1mbold\x1b[0m");
  assert.match(out, /font-weight:bold/);
  assert.match(out, />bold<\/span>/);
});

test("256-color cube index expands to rgb()", () => {
  // 196 = top of the 6x6x6 cube → pure red rgb(255,0,0)
  const out = ansiToHtml("\x1b[38;5;196mfoo\x1b[0m");
  assert.match(out, /color:rgb\(255,0,0\)/);
});

test("truecolor SGR maps r;g;b directly", () => {
  const out = ansiToHtml("\x1b[38;2;10;20;30mhi\x1b[0m");
  assert.match(out, /color:rgb\(10,20,30\)/);
});

test("background colour rendered separately", () => {
  const out = ansiToHtml("\x1b[48;5;21mbg\x1b[0m");
  assert.match(out, /background:rgb\(0,0,255\)/);
});

test("reset (0m) closes the span and unstyled text follows bare", () => {
  const out = ansiToHtml("\x1b[31ma\x1b[0mb");
  assert.match(out, /<\/span>b$/);
});

test("inverse swaps foreground and background", () => {
  const out = ansiToHtml("\x1b[31;42;7mx\x1b[0m");
  // fg becomes bg colour (green = #00cd00), bg becomes fg colour (red = #cd0000)
  assert.match(out, /color:#00cd00/);
  assert.match(out, /background:#cd0000/);
});

test("unknown SGR codes are ignored without breaking the stream", () => {
  const out = ansiToHtml("\x1b[99mtext\x1b[0m");
  assert.match(out, /text/);
  assert.doesNotMatch(out, /99/);
});

test("non-SGR CSI sequences are stripped without dropping surrounding text", () => {
  // \x1b[2J = clear screen — not SGR. We should swallow it; surrounding text stays.
  const out = ansiToHtml("a\x1b[2Jb");
  assert.equal(out, "ab");
});

test("bare ESC bytes are skipped", () => {
  assert.equal(ansiToHtml("a\x1bb"), "ab");
});

test("nested style: bold then color stacks until reset", () => {
  const out = ansiToHtml("\x1b[1m\x1b[31mboldred\x1b[0m");
  assert.match(out, /font-weight:bold/);
  assert.match(out, /color:#cd0000/);
});

test("ampersands inside styled text are escaped", () => {
  const out = ansiToHtml("\x1b[31ma & b\x1b[0m");
  assert.match(out, />a &amp; b</);
});
