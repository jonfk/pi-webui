#!/usr/bin/env node

// PROTOTYPE - terminal driver for the pure @ file completion text parser.

import { stdin as input } from "node:process";
import { applyAtCompletion, findAtCompletionContext } from "./at-file-text-parser-prototype.mjs";

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";

const scenarios = [
	{
		name: "detects @src after a boundary",
		text: "hello @src",
		cursor: "hello @src".length,
		item: { value: "@src/index.ts", label: "index.ts", isDirectory: false },
	},
	{
		name: "does not detect foo@src",
		text: "foo@src",
		cursor: "foo@src".length,
		item: { value: "@src/index.ts", label: "index.ts", isDirectory: false },
	},
	{
		name: "detects quoted @ path",
		text: '@"my folder/te"',
		cursor: '@"my folder/te'.length,
		item: { value: '@"my folder/test.txt"', label: "test.txt", isDirectory: false },
	},
	{
		name: "handles multiline textarea offsets",
		text: "first line\nthen @src/rou",
		cursor: "first line\nthen @src/rou".length,
		item: { value: "@src/routes.ts", label: "routes.ts", isDirectory: false },
	},
	{
		name: "file completion adds a trailing space",
		text: "open @README",
		cursor: "open @README".length,
		item: { value: "@README.md", label: "README.md", isDirectory: false },
	},
	{
		name: "directory completion keeps cursor before closing quote",
		text: '@"my folder/s"',
		cursor: '@"my folder/s'.length,
		item: { value: '@"my folder/src/"', label: "src/", isDirectory: true },
	},
	{
		name: "quoted replacement does not duplicate closing quote",
		text: '@"my folder/te"',
		cursor: '@"my folder/te'.length,
		item: { value: '@"my folder/test.txt"', label: "test.txt", isDirectory: false },
	},
	{
		name: "selected range suppresses completion",
		text: "hello @src",
		cursor: "hello @".length,
		selectionEnd: "hello @src".length,
		item: { value: "@src/index.ts", label: "index.ts", isDirectory: false },
	},
];

let currentIndex = 0;

function marker(text, index) {
	return `${text.slice(0, index)}${bold}|${reset}${text.slice(index)}`;
}

function renderScenario() {
	const scenario = scenarios[currentIndex];
	const context = findAtCompletionContext(scenario.text, scenario.cursor, scenario.selectionEnd ?? scenario.cursor);
	const applied = context ? applyAtCompletion(scenario.text, scenario.cursor, context, scenario.item) : null;

	console.clear();
	console.log(`${bold}pi-webui @ file completion text parser prototype${reset}`);
	console.log(`${dim}Question: can textarea text + cursor offset replace Pi TUI line/column parsing?${reset}`);
	console.log("");
	console.log(`${bold}Scenario${reset}: ${scenario.name}`);
	console.log(`${bold}Input${reset}:`);
	console.log(marker(scenario.text, scenario.cursor));
	if (scenario.selectionEnd !== undefined && scenario.selectionEnd !== scenario.cursor) {
		console.log(`${bold}Selection${reset}: ${scenario.cursor}..${scenario.selectionEnd}`);
	}
	console.log("");
	console.log(`${bold}Context${reset}:`);
	console.log(JSON.stringify(context, null, 2));
	console.log("");
	console.log(`${bold}Item${reset}:`);
	console.log(JSON.stringify(scenario.item, null, 2));
	console.log("");
	console.log(`${bold}Applied${reset}:`);
	if (applied) {
		console.log(marker(applied.text, applied.cursorIndex));
		console.log(JSON.stringify(applied, null, 2));
	} else {
		console.log("null");
	}
	console.log("");
	console.log(`${bold}Keys${reset}: [n] ${dim}next${reset}  [p] ${dim}previous${reset}  [q] ${dim}quit${reset}`);
}

input.setRawMode?.(true);
input.resume();
input.setEncoding("utf8");
renderScenario();

input.on("data", (key) => {
	if (key === "q" || key === "\u0003") {
		input.setRawMode?.(false);
		process.exit(0);
	}
	if (key === "n" || key === " ") {
		currentIndex = (currentIndex + 1) % scenarios.length;
	}
	if (key === "p") {
		currentIndex = (currentIndex - 1 + scenarios.length) % scenarios.length;
	}
	renderScenario();
});
