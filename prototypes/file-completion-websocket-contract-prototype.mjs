// PROTOTYPE - throwaway websocket contract for pi-webui @ file completion.
//
// Question: can a client send { type: "file_completion_request", requestId, prefix }
// and receive { type: "file_completion_result", payload: { requestId, prefix, items } }
// while the server keeps one active search per websocket and the client ignores
// stale result packets?

import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { OneActiveSearchController } from "./one-active-search-controller-prototype.mjs";

export function createFakeFileSearch({ onEvent = () => {} } = {}) {
	const started = [];

	async function search({ requestId, prefix, signal }) {
		const delayMs = prefix.includes("slow") ? 100 : 15;
		started.push({ requestId, prefix, delayMs, aborted: false });
		onEvent({ side: "server", type: "search_started", requestId, prefix, delayMs });

		await new Promise((resolve, reject) => {
			const timer = setTimeout(resolve, delayMs);
			signal.addEventListener(
				"abort",
				() => {
					clearTimeout(timer);
					const entry = started.find((candidate) => candidate.requestId === requestId);
					if (entry) entry.aborted = true;
					onEvent({ side: "server", type: "search_aborted", requestId, prefix });
					reject(new DOMException(String(signal.reason ?? "aborted"), "AbortError"));
				},
				{ once: true },
			);
		});

		if (signal.aborted) {
			return [];
		}

		return [
			{
				value: `${prefix}/contract-result.js`,
				label: "contract-result.js",
				description: `${prefix}/contract-result.js`,
				isDirectory: false,
			},
			{
				value: `${prefix}/nested/`,
				label: "nested/",
				description: `${prefix}/nested`,
				isDirectory: true,
			},
		];
	}

	function snapshot() {
		return started.map((entry) => ({ ...entry }));
	}

	return { search, snapshot };
}

export class FileCompletionWebsocketServerController {
	constructor({ ws, search, onEvent = () => {} }) {
		this.ws = ws;
		this.onEvent = onEvent;
		this.sent = [];
		this.activeSearch = new OneActiveSearchController({
			search,
			emit: (packet) => this.send(packet),
			onEvent: (event) => this.onEvent({ side: "server", ...event }),
		});
	}

	handle(packet) {
		if (packet?.type !== "file_completion_request") {
			this.onEvent({ side: "server", type: "ignored_packet", packetType: packet?.type || "unknown" });
			return;
		}
		const requestId = String(packet.requestId || "");
		const prefix = String(packet.prefix || "");
		if (!requestId || !prefix.startsWith("@")) {
			this.onEvent({ side: "server", type: "invalid_file_completion_request", requestId, prefix });
			this.send({ type: "file_completion_result", payload: { requestId, prefix, items: [] } });
			return;
		}
		this.activeSearch.request({ requestId, prefix });
	}

	close() {
		this.activeSearch.close();
	}

	send(packet) {
		this.sent.push(packet);
		if (this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(packet));
		}
	}

	snapshot() {
		return {
			sent: this.sent,
			activeSearch: this.activeSearch.snapshot(),
		};
	}
}

export class FileCompletionWebsocketClientController {
	constructor({ ws, onEvent = () => {} }) {
		this.ws = ws;
		this.onEvent = onEvent;
		this.currentRequestId = null;
		this.nextRequestNumber = 1;
		this.sent = [];
		this.acceptedResults = [];
		this.ignoredResults = [];
	}

	request(prefix) {
		const requestId = `req-${this.nextRequestNumber}`;
		this.nextRequestNumber += 1;
		this.currentRequestId = requestId;
		const packet = { type: "file_completion_request", requestId, prefix };
		this.sent.push(packet);
		this.ws.send(JSON.stringify(packet));
		this.onEvent({ side: "client", type: "sent_request", requestId, prefix });
		return requestId;
	}

	handle(packet) {
		if (packet?.type !== "file_completion_result") {
			this.onEvent({ side: "client", type: "ignored_packet", packetType: packet?.type || "unknown" });
			return;
		}
		const payload = packet.payload || {};
		if (payload.requestId !== this.currentRequestId) {
			this.ignoredResults.push(packet);
			this.onEvent({
				side: "client",
				type: "stale_result_ignored",
				requestId: payload.requestId,
				currentRequestId: this.currentRequestId,
			});
			return;
		}
		this.acceptedResults.push(packet);
		this.onEvent({
			side: "client",
			type: "result_accepted",
			requestId: payload.requestId,
			prefix: payload.prefix,
			itemCount: Array.isArray(payload.items) ? payload.items.length : 0,
		});
	}

	injectStaleResult(requestId, prefix) {
		this.handle({
			type: "file_completion_result",
			payload: {
				requestId,
				prefix,
				items: [{ value: "@stale.js", label: "stale.js", description: "synthetic stale packet", isDirectory: false }],
			},
		});
	}

	snapshot() {
		return {
			currentRequestId: this.currentRequestId,
			nextRequestNumber: this.nextRequestNumber,
			sent: this.sent,
			acceptedResults: this.acceptedResults,
			ignoredResults: this.ignoredResults,
		};
	}
}

export async function createWebsocketContractHarness({ onEvent = () => {} } = {}) {
	const httpServer = createServer();
	const websocketServer = new WebSocketServer({ server: httpServer, path: "/ws" });
	const fakeSearch = createFakeFileSearch({ onEvent });
	let serverController = null;

	websocketServer.on("connection", (ws) => {
		serverController = new FileCompletionWebsocketServerController({
			ws,
			search: fakeSearch.search,
			onEvent,
		});
		ws.on("message", (raw) => {
			serverController.handle(JSON.parse(String(raw)));
		});
		ws.on("close", () => {
			serverController.close();
			onEvent({ side: "server", type: "socket_closed" });
		});
	});

	await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
	const address = httpServer.address();
	const url = `ws://127.0.0.1:${address.port}/ws`;
	const clientSocket = new WebSocket(url);
	const clientController = new FileCompletionWebsocketClientController({
		ws: clientSocket,
		onEvent,
	});
	clientSocket.on("message", (raw) => {
		clientController.handle(JSON.parse(String(raw)));
	});
	await new Promise((resolve) => clientSocket.once("open", resolve));

	return {
		url,
		client: clientController,
		server: () => serverController,
		search: fakeSearch,
		async close() {
			clientSocket.close();
			await new Promise((resolve) => websocketServer.close(resolve));
			await new Promise((resolve) => httpServer.close(resolve));
		},
		snapshot() {
			return {
				url,
				client: clientController.snapshot(),
				server: serverController?.snapshot() ?? null,
				searches: fakeSearch.snapshot(),
			};
		},
	};
}
