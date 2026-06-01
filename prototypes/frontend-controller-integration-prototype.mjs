// PROTOTYPE - throwaway frontend controller integration model for @ file completion.
//
// Question: can pi-webui add a separate file completion controller before the
// existing slash/history/submit key handling without refactoring slash
// completion?

import { applyAtCompletion, findAtCompletionContext } from "./at-file-text-parser-prototype.mjs";

const SLASH_COMMANDS = [
	{ name: "clear", description: "clear the transcript" },
	{ name: "cwd", description: "change cwd" },
	{ name: "model", description: "change model" },
	{ name: "name", description: "rename session" },
	{ name: "workspace", description: "switch workspace" },
];

const MOCK_FILE_ITEMS = [
	{ path: "src/", isDirectory: true },
	{ path: "src/server/", isDirectory: true },
	{ path: "src/server/index.ts", isDirectory: false },
	{ path: "src/server/file-completion.ts", isDirectory: false },
	{ path: "public/", isDirectory: true },
	{ path: "public/app.js", isDirectory: false },
	{ path: "public/file-completion-controller.mjs", isDirectory: false },
	{ path: "docs/project/handoffs/2026-05-31-pi-webui-at-file-completion-prototypes-handoff.md", isDirectory: false },
	{ path: "my folder/", isDirectory: true },
	{ path: "my folder/templates/", isDirectory: true },
	{ path: "my folder/test file.txt", isDirectory: false },
];

function itemValue(path, context) {
	if (context.isQuoted || path.includes(" ")) {
		return `@"${path}"`;
	}
	return `@${path}`;
}

function labelForPath(path) {
	return path.split("/").filter(Boolean).at(-1) + (path.endsWith("/") ? "/" : "");
}

export function createMockFileCompletionItems(context) {
	const query = context.rawPrefix.toLowerCase();
	return MOCK_FILE_ITEMS.filter((item) => {
		if (query === "") return true;
		return item.path.toLowerCase().includes(query);
	})
		.slice(0, 8)
		.map((item) => ({
			value: itemValue(item.path, context),
			label: labelForPath(item.path),
			description: item.path,
			isDirectory: item.isDirectory,
		}));
}

export class FrontendFileCompletionControllerPrototype {
	constructor({ getInputState, setInputState, sendRequest, debounceMs = 100 }) {
		this.getInputState = getInputState;
		this.setInputState = setInputState;
		this.sendRequest = sendRequest;
		this.debounceMs = debounceMs;
		this.context = null;
		this.items = [];
		this.selectedIndex = 0;
		this.menuOpen = false;
		this.pendingRequest = null;
		this.currentRequestId = null;
		this.nextRequestId = 1;
		this.events = [];
	}

	onInputChanged() {
		const { value, selectionStart, selectionEnd } = this.getInputState();
		const context = findAtCompletionContext(value, selectionStart, selectionEnd);
		this.context = context;

		if (!context) {
			this.close("no_context");
			this.pendingRequest = null;
			return;
		}

		const requestId = `file-${this.nextRequestId}`;
		this.nextRequestId += 1;
		this.pendingRequest = { requestId, prefix: context.prefix, debounceMs: this.debounceMs };
		this.events.push({ type: "debounced_request", requestId, prefix: context.prefix });
	}

	flushDebounce() {
		if (!this.pendingRequest) return null;
		const request = this.pendingRequest;
		this.pendingRequest = null;
		this.currentRequestId = request.requestId;
		this.sendRequest({ type: "file_completion_request", requestId: request.requestId, prefix: request.prefix });
		this.events.push({ type: "request_sent", requestId: request.requestId, prefix: request.prefix });
		return request;
	}

	receiveResult({ requestId, prefix, items }) {
		if (requestId !== this.currentRequestId) {
			this.events.push({ type: "stale_result_ignored", requestId, prefix });
			return;
		}

		const { value, selectionStart, selectionEnd } = this.getInputState();
		const context = findAtCompletionContext(value, selectionStart, selectionEnd);
		if (!context || context.prefix !== prefix) {
			this.events.push({ type: "context_changed_result_ignored", requestId, prefix });
			return;
		}

		this.context = context;
		this.items = items;
		this.selectedIndex = 0;
		this.menuOpen = items.length > 0;
		this.events.push({ type: "result_opened", requestId, prefix, itemCount: items.length });
	}

	handleKeydown(event) {
		if (!this.menuOpen || this.items.length === 0) {
			return false;
		}

		if (event.key === "ArrowDown") {
			event.preventDefault();
			this.selectedIndex = (this.selectedIndex + 1) % this.items.length;
			this.events.push({ type: "file_key_consumed", key: event.key });
			return true;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			this.selectedIndex = (this.selectedIndex - 1 + this.items.length) % this.items.length;
			this.events.push({ type: "file_key_consumed", key: event.key });
			return true;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			this.close("escape");
			this.events.push({ type: "file_key_consumed", key: event.key });
			return true;
		}
		if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey && !event.isComposing)) {
			event.preventDefault();
			this.applySelected();
			this.events.push({ type: "file_key_consumed", key: event.key });
			return true;
		}

		return false;
	}

	applySelected() {
		const item = this.items[this.selectedIndex];
		if (!this.context || !item) {
			throw new Error("Cannot apply file completion without a selected item");
		}
		const { value, selectionStart } = this.getInputState();
		const next = applyAtCompletion(value, selectionStart, this.context, item);
		this.setInputState({ value: next.text, selectionStart: next.cursorIndex, selectionEnd: next.cursorIndex });
		this.close("applied");
	}

	close(reason) {
		if (this.menuOpen || this.items.length > 0) {
			this.events.push({ type: "file_menu_closed", reason });
		}
		this.menuOpen = false;
		this.items = [];
		this.selectedIndex = 0;
	}

	snapshot() {
		return {
			context: this.context,
			menuOpen: this.menuOpen,
			selectedIndex: this.selectedIndex,
			pendingRequest: this.pendingRequest,
			currentRequestId: this.currentRequestId,
			items: this.items,
		};
	}
}

function parseSlash(text) {
	const match = text.match(/^\/([^\s]*)(?:\s+(.*))?$/);
	if (!match) return null;
	return { name: match[1] || "", arg: match[2] ?? "" };
}

function createKeyEvent(key, options = {}) {
	return {
		key,
		shiftKey: Boolean(options.shiftKey),
		altKey: Boolean(options.altKey),
		metaKey: Boolean(options.metaKey),
		ctrlKey: Boolean(options.ctrlKey),
		isComposing: Boolean(options.isComposing),
		defaultPrevented: false,
		preventDefault() {
			this.defaultPrevented = true;
		},
	};
}

export class FrontendIntegrationHarnessPrototype {
	constructor() {
		this.input = { value: "", selectionStart: 0, selectionEnd: 0 };
		this.slashFiltered = [];
		this.slashIndex = 0;
		this.history = ["older prompt", "ask about @src/server/index.ts"];
		this.historyIndex = this.history.length;
		this.submits = [];
		this.sentRequests = [];
		this.events = [];
		this.fileController = new FrontendFileCompletionControllerPrototype({
			getInputState: () => ({ ...this.input }),
			setInputState: (next) => {
				this.input = { ...this.input, ...next };
			},
			sendRequest: (message) => {
				this.sentRequests.push(message);
			},
		});
	}

	type(text) {
		const before = this.input.value.slice(0, this.input.selectionStart);
		const after = this.input.value.slice(this.input.selectionEnd);
		const value = before + text + after;
		const cursor = before.length + text.length;
		this.input = { value, selectionStart: cursor, selectionEnd: cursor };
		this.onInputChanged();
	}

	backspace() {
		if (this.input.selectionStart === 0 || this.input.selectionStart !== this.input.selectionEnd) return;
		const before = this.input.value.slice(0, this.input.selectionStart - 1);
		const after = this.input.value.slice(this.input.selectionEnd);
		this.input = { value: before + after, selectionStart: before.length, selectionEnd: before.length };
		this.onInputChanged();
	}

	setInput(value, cursor = value.length) {
		this.input = { value, selectionStart: cursor, selectionEnd: cursor };
		this.onInputChanged();
	}

	onInputChanged() {
		this.fileController.onInputChanged();
		this.updateSlashMenu();
	}

	flushFileRequest() {
		const request = this.fileController.flushDebounce();
		if (!request) return null;
		const context = findAtCompletionContext(this.input.value, this.input.selectionStart, this.input.selectionEnd);
		if (!context) throw new Error("Cannot build mock results without a current @ context");
		const items = createMockFileCompletionItems(context);
		return { ...request, items };
	}

	deliverLatestFileResult() {
		const request = this.sentRequests.at(-1);
		if (!request) return null;
		const context = findAtCompletionContext(this.input.value, this.input.selectionStart, this.input.selectionEnd);
		if (!context) throw new Error("Cannot deliver mock results without a current @ context");
		const items = createMockFileCompletionItems(context);
		this.fileController.receiveResult({ requestId: request.requestId, prefix: request.prefix, items });
		return { requestId: request.requestId, prefix: request.prefix, itemCount: items.length };
	}

	deliverStaleFileResult() {
		this.fileController.receiveResult({
			requestId: "stale-request",
			prefix: "@src",
			items: [{ value: "@stale.txt", label: "stale.txt", description: "stale", isDirectory: false }],
		});
	}

	keydown(key, options = {}) {
		const event = createKeyEvent(key, options);
		if (this.fileController.handleKeydown(event)) {
			this.events.push({ type: "file_controller_consumed", key });
			return { consumedBy: "file", event };
		}

		if (this.slashFiltered.length > 0) {
			if (key === "ArrowDown") {
				event.preventDefault();
				this.slashIndex = (this.slashIndex + 1) % this.slashFiltered.length;
				this.events.push({ type: "slash_consumed", key });
				return { consumedBy: "slash", event };
			}
			if (key === "ArrowUp") {
				event.preventDefault();
				this.slashIndex = (this.slashIndex - 1 + this.slashFiltered.length) % this.slashFiltered.length;
				this.events.push({ type: "slash_consumed", key });
				return { consumedBy: "slash", event };
			}
			if (key === "Tab") {
				event.preventDefault();
				this.applySlashSelection();
				this.events.push({ type: "slash_consumed", key });
				return { consumedBy: "slash", event };
			}
			if (key === "Escape") {
				event.preventDefault();
				this.slashFiltered = [];
				this.events.push({ type: "slash_consumed", key });
				return { consumedBy: "slash", event };
			}
			if (key === "Enter" && !event.shiftKey && !event.isComposing) {
				event.preventDefault();
				const cmd = this.slashFiltered[this.slashIndex];
				if (cmd) this.setInput(`/${cmd.name}`, `/${cmd.name}`.length);
				this.slashFiltered = [];
				this.submit();
				this.events.push({ type: "slash_consumed", key });
				return { consumedBy: "slash", event };
			}
		}

		if (key === "Enter" && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			this.submit();
			this.events.push({ type: "submit_consumed", key });
			return { consumedBy: "submit", event };
		}

		if (key === "ArrowUp" && this.input.selectionStart === 0 && this.input.selectionEnd === 0) {
			event.preventDefault();
			if (this.historyIndex > 0) {
				this.historyIndex -= 1;
				this.setInput(this.history[this.historyIndex], 0);
			}
			this.events.push({ type: "history_consumed", key });
			return { consumedBy: "history", event };
		}

		if (key === "ArrowDown" && this.input.selectionStart === this.input.value.length && this.input.selectionEnd === this.input.value.length) {
			event.preventDefault();
			if (this.historyIndex < this.history.length) {
				this.historyIndex += 1;
				const value = this.historyIndex === this.history.length ? "" : this.history[this.historyIndex];
				this.setInput(value, value.length);
			}
			this.events.push({ type: "history_consumed", key });
			return { consumedBy: "history", event };
		}

		this.events.push({ type: "unhandled_key", key });
		return { consumedBy: null, event };
	}

	updateSlashMenu() {
		const parsed = parseSlash(this.input.value);
		if (!parsed || parsed.arg) {
			this.slashFiltered = [];
			this.slashIndex = 0;
			return;
		}
		const prefix = parsed.name.toLowerCase();
		this.slashFiltered = SLASH_COMMANDS.filter((command) => command.name.startsWith(prefix));
		this.slashIndex = 0;
	}

	applySlashSelection() {
		const cmd = this.slashFiltered[this.slashIndex];
		if (!cmd) return;
		this.setInput(`/${cmd.name} `, `/${cmd.name} `.length);
		this.slashFiltered = [];
	}

	submit() {
		const message = this.input.value.trim();
		if (!message) return;
		this.submits.push(message);
		this.setInput("");
	}

	snapshot() {
		return {
			input: this.input,
			file: this.fileController.snapshot(),
			slash: {
				open: this.slashFiltered.length > 0,
				index: this.slashIndex,
				items: this.slashFiltered,
			},
			sentRequests: this.sentRequests,
			submits: this.submits,
			events: this.events.slice(-12),
			fileEvents: this.fileController.events.slice(-12),
		};
	}
}
