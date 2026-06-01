#!/usr/bin/env node

// PROTOTYPE - scripted driver for the @ file completion websocket contract.

import { createWebsocketContractHarness } from "./file-completion-websocket-contract-prototype.mjs";

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";

const events = [];

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function record(event) {
	events.push({ tick: events.length + 1, ...event });
}

function printSnapshot(title, harness) {
	console.log(`${bold}${title}${reset}`);
	console.log(JSON.stringify(harness.snapshot(), null, 2));
	console.log("");
}

async function main() {
	console.log(`${bold}pi-webui @ file completion websocket contract prototype${reset}`);
	console.log(`${dim}Question: can the browser and server exchange request/result packets while suppressing stale work?${reset}`);
	console.log("");

	const harness = await createWebsocketContractHarness({ onEvent: record });
	try {
		console.log(`${bold}Websocket URL${reset}: ${harness.url}`);
		console.log("");
		printSnapshot("Initial state", harness);

		const staleRequestId = harness.client.request("@slow-src");
		await sleep(5);
		printSnapshot("After slow request", harness);

		const currentRequestId = harness.client.request("@src");
		await sleep(35);
		printSnapshot("After replacing slow request with fast request", harness);

		harness.client.injectStaleResult(staleRequestId, "@slow-src");
		printSnapshot("After synthetic stale client result", harness);

		console.log(`${bold}Contract checks${reset}:`);
		const snapshot = harness.snapshot();
		const serverSentIds = snapshot.server.sent.map((packet) => packet.payload.requestId);
		const acceptedIds = snapshot.client.acceptedResults.map((packet) => packet.payload.requestId);
		const ignoredIds = snapshot.client.ignoredResults.map((packet) => packet.payload.requestId);
		const abortedIds = snapshot.searches.filter((entry) => entry.aborted).map((entry) => entry.requestId);
		console.log(`server sent result ids: ${JSON.stringify(serverSentIds)}`);
		console.log(`client accepted result ids: ${JSON.stringify(acceptedIds)}`);
		console.log(`client ignored result ids: ${JSON.stringify(ignoredIds)}`);
		console.log(`aborted search ids: ${JSON.stringify(abortedIds)}`);
		console.log("");

		if (serverSentIds.length !== 1 || serverSentIds[0] !== currentRequestId) {
			throw new Error("expected the server to emit only the current request result");
		}
		if (acceptedIds.length !== 1 || acceptedIds[0] !== currentRequestId) {
			throw new Error("expected the client to accept only the current request result");
		}
		if (!ignoredIds.includes(staleRequestId)) {
			throw new Error("expected the client to ignore a stale result packet");
		}
		if (!abortedIds.includes(staleRequestId)) {
			throw new Error("expected the server search for the replaced request to abort");
		}

		console.log(`${bold}Recent events${reset}:`);
		for (const event of events) {
			console.log(JSON.stringify(event));
		}
		console.log("");
		console.log(`${bold}Verdict${reset}: websocket contract shape is viable for production wiring.`);
	} finally {
		await harness.close();
	}
}

await main();
