#!/usr/bin/env node

// PROTOTYPE - interactive terminal driver for typing through @ file completion.

import { stdin as input } from "node:process";
import { applyAtCompletion, findAtCompletionContext } from "./at-file-text-parser-prototype.mjs";

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reverse = "\x1b[7m";
const reset = "\x1b[0m";

const mockPaths = [
	{ path: "src/", isDirectory: true },
	{ path: "src/routes.ts", isDirectory: false },
	{ path: "src/server/", isDirectory: true },
	{ path: "src/server/index.ts", isDirectory: false },
	{ path: "src/server/file-completion.ts", isDirectory: false },
	{ path: "public/", isDirectory: true },
	{ path: "public/app.js", isDirectory: false },
	{ path: "public/file-completion-controller.mjs", isDirectory: false },
	{ path: "README.md", isDirectory: false },
	{ path: "docs/project/handoffs/2026-05-31-pi-webui-at-file-completion-prototypes-handoff.md", isDirectory: false },
	{ path: "my folder/", isDirectory: true },
	{ path: "my folder/src/", isDirectory: true },
	{ path: "my folder/test.txt", isDirectory: false },
	{ path: "my folder/templates/", isDirectory: true },
];

let text = 'Try @src or @"my folder/te"';
let cursorIndex = text.length - 1;
let selectedIndex = 0;

function buildValue(path, context) {
	const needsQuotes = context.isQuoted || path.includes(" ");
	if (!needsQuotes) {
		return `@${path}`;
	}
	return `@"${path}"`;
}

function buildCompletions(context) {
	if (!context) {
		return [];
	}

	const query = context.rawPrefix.toLowerCase();
	const filtered = mockPaths.filter(({ path }) => {
		if (query === "") {
			return true;
		}
		return path.toLowerCase().includes(query);
	});

	return filtered.slice(0, 8).map(({ path, isDirectory }) => ({
		value: buildValue(path, context),
		label: path.split("/").filter(Boolean).at(-1) + (isDirectory ? "/" : ""),
		description: path,
		isDirectory,
	}));
}

function marker(value, index) {
	return `${value.slice(0, index)}${bold}|${reset}${value.slice(index)}`;
}

function activeState() {
	const context = findAtCompletionContext(text, cursorIndex);
	const items = buildCompletions(context);
	if (selectedIndex >= items.length) {
		selectedIndex = 0;
	}
	const selectedItem = items[selectedIndex] ?? null;
	const preview = context && selectedItem ? applyAtCompletion(text, cursorIndex, context, selectedItem) : null;

	return { context, items, selectedItem, preview };
}

function render() {
	const { context, items, selectedItem, preview } = activeState();

	console.clear();
	console.log(`${bold}pi-webui @ file completion interactive prototype${reset}`);
	console.log(`${dim}Type normally. Mocked completions are generated from the parser context.${reset}`);
	console.log("");
	console.log(`${bold}Prompt${reset}:`);
	console.log(marker(text, cursorIndex));
	console.log("");
	console.log(`${bold}Context${reset}:`);
	console.log(JSON.stringify(context, null, 2));
	console.log("");
	console.log(`${bold}Mock completions${reset}:`);
	if (items.length === 0) {
		console.log(`${dim}none${reset}`);
	} else {
		for (let i = 0; i < items.length; i += 1) {
			const item = items[i];
			const line = `${item.label.padEnd(36)} ${dim}${item.value}${reset}`;
			console.log(i === selectedIndex ? `${reverse}${line}${reset}` : line);
		}
	}
	console.log("");
	console.log(`${bold}Selected item${reset}:`);
	console.log(JSON.stringify(selectedItem, null, 2));
	console.log("");
	console.log(`${bold}Apply preview${reset}:`);
	if (preview) {
		console.log(marker(preview.text, preview.cursorIndex));
		console.log(JSON.stringify(preview, null, 2));
	} else {
		console.log(`${dim}none${reset}`);
	}
	console.log("");
	console.log(
		`${bold}Keys${reset}: type ${dim}insert${reset}  Backspace ${dim}delete${reset}  ←/→ ${dim}move cursor${reset}  ↑/↓ ${dim}select${reset}  Tab/Enter ${dim}apply${reset}  Ctrl+L ${dim}reset${reset}  Ctrl+C ${dim}quit${reset}`,
	);
}

function insert(value) {
	text = text.slice(0, cursorIndex) + value + text.slice(cursorIndex);
	cursorIndex += value.length;
	selectedIndex = 0;
}

function backspace() {
	if (cursorIndex === 0) {
		return;
	}
	text = text.slice(0, cursorIndex - 1) + text.slice(cursorIndex);
	cursorIndex -= 1;
	selectedIndex = 0;
}

function applySelected() {
	const { context, selectedItem } = activeState();
	if (!context || !selectedItem) {
		insert("\n");
		return;
	}

	const next = applyAtCompletion(text, cursorIndex, context, selectedItem);
	text = next.text;
	cursorIndex = next.cursorIndex;
	selectedIndex = 0;
}

function handleKey(key) {
	if (key === "\u0003") {
		input.setRawMode?.(false);
		process.exit(0);
	}
	if (key === "\u000c") {
		text = "";
		cursorIndex = 0;
		selectedIndex = 0;
		return;
	}
	if (key === "\u007f") {
		backspace();
		return;
	}
	if (key === "\t" || key === "\r") {
		applySelected();
		return;
	}
	if (key === "\x1b[A") {
		const { items } = activeState();
		if (items.length > 0) {
			selectedIndex = (selectedIndex - 1 + items.length) % items.length;
		}
		return;
	}
	if (key === "\x1b[B") {
		const { items } = activeState();
		if (items.length > 0) {
			selectedIndex = (selectedIndex + 1) % items.length;
		}
		return;
	}
	if (key === "\x1b[C") {
		cursorIndex = Math.min(cursorIndex + 1, text.length);
		selectedIndex = 0;
		return;
	}
	if (key === "\x1b[D") {
		cursorIndex = Math.max(cursorIndex - 1, 0);
		selectedIndex = 0;
		return;
	}
	if (key.length === 1 && key >= " ") {
		insert(key);
	}
}

function splitKeys(chunk) {
	const keys = [];
	let index = 0;
	while (index < chunk.length) {
		if (chunk.startsWith("\x1b[", index)) {
			keys.push(chunk.slice(index, index + 3));
			index += 3;
		} else {
			keys.push(chunk[index]);
			index += 1;
		}
	}
	return keys;
}

input.setRawMode?.(true);
input.resume();
input.setEncoding("utf8");
render();

input.on("data", (chunk) => {
	for (const key of splitKeys(chunk)) {
		handleKey(key);
	}
	render();
});
