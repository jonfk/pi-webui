#!/usr/bin/env node

// PROTOTYPE - interactive driver for one active file search per websocket.

import { stdin as input } from "node:process";
import { createManualSearchHarness, OneActiveSearchController } from "./one-active-search-controller-prototype.mjs";

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reverse = "\x1b[7m";
const reset = "\x1b[0m";

const harness = createManualSearchHarness();
const emitted = [];
const events = [];
let requestCounter = 1;
let prefixCursor = 0;

const prefixes = ["@src", "@src/se", '@"my folder/te"', "@../docs", "@/absolute/path"];

const controller = new OneActiveSearchController({
	search: harness.search,
	emit: (message) => emitted.push(message),
	onEvent: (event) => events.push({ ...event, tick: events.length + 1 }),
});

function currentPrefix() {
	return prefixes[prefixCursor];
}

function nextRequestId() {
	const requestId = `req-${requestCounter}`;
	requestCounter += 1;
	return requestId;
}

function request() {
	controller.request({ requestId: nextRequestId(), prefix: currentPrefix() });
}

function cyclePrefix(offset) {
	prefixCursor = (prefixCursor + offset + prefixes.length) % prefixes.length;
}

function render() {
	console.clear();
	console.log(`${bold}one active @ file search per websocket prototype${reset}`);
	console.log(`${dim}Drive overlapping requests, then resolve old work to check stale result suppression.${reset}`);
	console.log("");

	console.log(`${bold}Question${reset}:`);
	console.log("What state should a websocket controller keep so a new file_completion_request aborts the previous search");
	console.log("and only the still-current requestId can emit a file_completion_result?");
	console.log("");

	console.log(`${bold}Selected prefix${reset}: ${reverse}${currentPrefix()}${reset}`);
	console.log("");

	console.log(`${bold}Controller state${reset}:`);
	console.log(JSON.stringify(controller.snapshot(), null, 2));
	console.log("");

	console.log(`${bold}Manual search promises${reset}:`);
	const pending = harness.snapshot();
	if (pending.length === 0) {
		console.log(`${dim}none${reset}`);
	} else {
		console.log(JSON.stringify(pending, null, 2));
	}
	console.log("");

	console.log(`${bold}Emitted websocket messages${reset}:`);
	if (emitted.length === 0) {
		console.log(`${dim}none${reset}`);
	} else {
		console.log(JSON.stringify(emitted, null, 2));
	}
	console.log("");

	console.log(`${bold}Recent events${reset}:`);
	for (const event of events.slice(-12)) {
		console.log(JSON.stringify(event));
	}
	if (events.length === 0) {
		console.log(`${dim}none${reset}`);
	}
	console.log("");

	console.log(
		`${bold}Keys${reset}: ${bold}r${reset} ${dim}request${reset}  ${bold}f${reset} ${dim}finish oldest pending${reset}  ${bold}e${reset} ${dim}fail oldest pending${reset}  ${bold}c${reset} ${dim}close socket${reset}  ${bold}[${reset}/${bold}]${reset} ${dim}change prefix${reset}  ${bold}q${reset} ${dim}quit${reset}`,
	);
}

function handleKey(key) {
	if (key === "\u0003" || key === "q") {
		input.setRawMode?.(false);
		process.exit(0);
	}
	if (key === "r") {
		request();
		return;
	}
	if (key === "f") {
		const finished = harness.finishOldest();
		if (!finished) {
			events.push({ type: "no_pending_to_finish", tick: events.length + 1 });
		}
		return;
	}
	if (key === "e") {
		const failed = harness.failOldest();
		if (!failed) {
			events.push({ type: "no_pending_to_fail", tick: events.length + 1 });
		}
		return;
	}
	if (key === "c") {
		controller.close();
		return;
	}
	if (key === "[") {
		cyclePrefix(-1);
		return;
	}
	if (key === "]") {
		cyclePrefix(1);
	}
}

input.setRawMode?.(true);
input.resume();
input.setEncoding("utf8");
render();

input.on("data", (chunk) => {
	for (const key of chunk) {
		handleKey(key);
	}
	setImmediate(render);
});
