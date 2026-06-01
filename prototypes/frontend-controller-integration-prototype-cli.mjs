#!/usr/bin/env node

// PROTOTYPE - interactive driver for frontend @ file completion controller integration.

import { stdin as input } from "node:process";
import { FrontendIntegrationHarnessPrototype } from "./frontend-controller-integration-prototype.mjs";

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reverse = "\x1b[7m";
const reset = "\x1b[0m";

const harness = new FrontendIntegrationHarnessPrototype();

function marker(value, index) {
	return `${value.slice(0, index)}${bold}|${reset}${value.slice(index)}`;
}

function renderItems(title, items, selectedIndex) {
	console.log(`${bold}${title}${reset}:`);
	if (items.length === 0) {
		console.log(`${dim}closed${reset}`);
		return;
	}
	for (let i = 0; i < items.length; i += 1) {
		const item = items[i];
		const left = item.label ?? `/${item.name}`;
		const right = item.description ?? "";
		const line = `${left.padEnd(36)} ${dim}${right}${reset}`;
		console.log(i === selectedIndex ? `${reverse}${line}${reset}` : line);
	}
}

function render() {
	const state = harness.snapshot();
	console.clear();
	console.log(`${bold}pi-webui frontend @ completion integration prototype${reset}`);
	console.log(`${dim}Throwaway state harness for file-vs-slash key precedence, request lifecycle, and replacement.${reset}`);
	console.log("");
	console.log(`${bold}Question${reset}:`);
	console.log("Can a separate file completion controller run before slash/history/submit handling without refactoring slash completion?");
	console.log("");
	console.log(`${bold}Textarea${reset}:`);
	console.log(marker(state.input.value, state.input.selectionStart));
	console.log("");
	renderItems("File menu", state.file.items, state.file.selectedIndex);
	console.log("");
	renderItems("Slash menu", state.slash.items, state.slash.index);
	console.log("");
	console.log(`${bold}File controller state${reset}:`);
	console.log(
		JSON.stringify(
			{
				context: state.file.context,
				menuOpen: state.file.menuOpen,
				pendingRequest: state.file.pendingRequest,
				currentRequestId: state.file.currentRequestId,
			},
			null,
			2,
		),
	);
	console.log("");
	console.log(`${bold}Sent file requests${reset}:`);
	console.log(state.sentRequests.length === 0 ? `${dim}none${reset}` : JSON.stringify(state.sentRequests, null, 2));
	console.log("");
	console.log(`${bold}Submits${reset}:`);
	console.log(state.submits.length === 0 ? `${dim}none${reset}` : JSON.stringify(state.submits, null, 2));
	console.log("");
	console.log(`${bold}Recent events${reset}:`);
	for (const event of [...state.fileEvents, ...state.events].slice(-12)) {
		console.log(JSON.stringify(event));
	}
	if (state.fileEvents.length === 0 && state.events.length === 0) {
		console.log(`${dim}none${reset}`);
	}
	console.log("");
	console.log(
		`${bold}Keys${reset}: type ${dim}insert${reset}  Backspace ${dim}delete${reset}  ↑/↓ ${dim}dispatch${reset}  Tab/Enter/Esc ${dim}dispatch${reset}`,
	);
	console.log(
		`      ${bold}f${reset} ${dim}flush debounce${reset}  ${bold}g${reset} ${dim}deliver result${reset}  ${bold}s${reset} ${dim}stale result${reset}  ${bold}1${reset}/${bold}2${reset}/${bold}3${reset}/${bold}4${reset} ${dim}scenarios${reset}  ${bold}Ctrl+L${reset} ${dim}clear${reset}  ${bold}Ctrl+C${reset} ${dim}quit${reset}`,
	);
}

function runScenario(key) {
	if (key === "1") {
		harness.setInput("please inspect @src");
		harness.flushFileRequest();
		harness.deliverLatestFileResult();
		return;
	}
	if (key === "2") {
		harness.setInput("/mo");
		return;
	}
	if (key === "3") {
		harness.setInput("/mo @src");
		harness.flushFileRequest();
		harness.deliverLatestFileResult();
		return;
	}
	if (key === "4") {
		harness.setInput('please inspect @"my folder/te"');
		harness.flushFileRequest();
		harness.deliverLatestFileResult();
	}
}

function handleKey(key) {
	if (key === "\u0003") {
		input.setRawMode?.(false);
		process.exit(0);
	}
	if (key === "\u000c") {
		harness.setInput("");
		return;
	}
	if (["1", "2", "3", "4"].includes(key)) {
		runScenario(key);
		return;
	}
	if (key === "f") {
		harness.flushFileRequest();
		return;
	}
	if (key === "g") {
		harness.deliverLatestFileResult();
		return;
	}
	if (key === "s") {
		harness.deliverStaleFileResult();
		return;
	}
	if (key === "\u007f") {
		harness.backspace();
		return;
	}
	if (key === "\x1b[A") {
		harness.keydown("ArrowUp");
		return;
	}
	if (key === "\x1b[B") {
		harness.keydown("ArrowDown");
		return;
	}
	if (key === "\t") {
		harness.keydown("Tab");
		return;
	}
	if (key === "\r") {
		harness.keydown("Enter");
		return;
	}
	if (key === "\x1b") {
		harness.keydown("Escape");
		return;
	}
	if (key.length === 1 && key >= " ") {
		harness.type(key);
	}
}

function splitKeys(chunk) {
	const keys = [];
	let index = 0;
	while (index < chunk.length) {
		if (chunk.startsWith("\x1b[A", index) || chunk.startsWith("\x1b[B", index)) {
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
	setImmediate(render);
});
