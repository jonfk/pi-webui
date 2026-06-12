import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const packageRoot = new URL("..", import.meta.url);

test("build emits generated client assets and the shell references them", () => {
  const root = packageRoot.pathname;
  assert.equal(existsSync(join(root, "dist/server/index.js")), true);
  assert.equal(existsSync(join(root, "dist/client/sidebar.js")), true);
  assert.equal(existsSync(join(root, "dist/client/sidebar.css")), true);

  const index = readFileSync(join(root, "public/index.html"), "utf8");
  assert.match(index, /id="workspace-sidebar-root"/);
  assert.match(index, /href="\/client\/sidebar\.css"/);
  assert.match(index, /src="\/client\/sidebar\.js"/);
});
