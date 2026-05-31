// PROTOTYPE - per-websocket file-completion search cancellation model.
//
// Question: what is the smallest state model that guarantees only one active
// file completion search per websocket, aborts replaced/closed searches, and
// prevents stale async results from being emitted?

export class OneActiveSearchController {
	constructor({ search, emit, onEvent = () => {} }) {
		this.search = search;
		this.emit = emit;
		this.onEvent = onEvent;
		this.active = null;
		this.nextSequence = 1;
		this.closed = false;
	}

	request({ requestId, prefix }) {
		if (this.closed) {
			this.onEvent({ type: "ignored_after_close", requestId, prefix });
			return;
		}

		this.abortActive("replaced");

		const sequence = this.nextSequence;
		this.nextSequence += 1;
		const abortController = new AbortController();
		const active = {
			sequence,
			requestId,
			prefix,
			abortController,
			status: "running",
		};
		this.active = active;
		this.onEvent({ type: "started", sequence, requestId, prefix });

		void this.search({ requestId, prefix, signal: abortController.signal })
			.then((items) => {
				if (this.active !== active || abortController.signal.aborted || this.closed) {
					this.onEvent({ type: "stale_result_suppressed", sequence, requestId, prefix });
					return;
				}
				active.status = "completed";
				this.active = null;
				this.emit({ type: "file_completion_result", payload: { requestId, prefix, items } });
				this.onEvent({ type: "emitted", sequence, requestId, prefix, itemCount: items.length });
			})
			.catch((error) => {
				if (abortController.signal.aborted) {
					this.onEvent({ type: "abort_settled", sequence, requestId, prefix });
					return;
				}
				if (this.active !== active || this.closed) {
					this.onEvent({ type: "stale_error_suppressed", sequence, requestId, prefix });
					return;
				}
				active.status = "failed";
				this.active = null;
				this.emit({ type: "file_completion_result", payload: { requestId, prefix, items: [] } });
				this.onEvent({
					type: "search_failed_empty_result",
					sequence,
					requestId,
					prefix,
					error: error instanceof Error ? error.message : String(error),
				});
			});
	}

	close() {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.abortActive("socket_closed");
		this.onEvent({ type: "closed" });
	}

	snapshot() {
		return {
			closed: this.closed,
			nextSequence: this.nextSequence,
			active: this.active
				? {
						sequence: this.active.sequence,
						requestId: this.active.requestId,
						prefix: this.active.prefix,
						status: this.active.status,
						aborted: this.active.abortController.signal.aborted,
					}
				: null,
		};
	}

	abortActive(reason) {
		if (!this.active) {
			return;
		}
		const active = this.active;
		active.status = "aborted";
		active.abortController.abort(reason);
		this.active = null;
		this.onEvent({
			type: "aborted",
			reason,
			sequence: active.sequence,
			requestId: active.requestId,
			prefix: active.prefix,
		});
	}
}

export function createManualSearchHarness() {
	const pending = [];

	function search({ requestId, prefix, signal }) {
		return new Promise((resolve, reject) => {
			const entry = {
				requestId,
				prefix,
				signal,
				status: "pending",
				resolve: (items) => {
					entry.status = "resolved";
					resolve(items);
				},
				reject: (error) => {
					entry.status = "rejected";
					reject(error);
				},
			};

			signal.addEventListener(
				"abort",
				() => {
					entry.status = "aborted";
					reject(new DOMException(String(signal.reason ?? "aborted"), "AbortError"));
				},
				{ once: true },
			);

			pending.push(entry);
		});
	}

	function finishOldest() {
		const entry = pending.find((candidate) => candidate.status === "pending");
		if (!entry) {
			return null;
		}
		entry.resolve([{ value: `${entry.prefix}/result`, label: "result", description: "manual fake result", isDirectory: false }]);
		return { requestId: entry.requestId, prefix: entry.prefix };
	}

	function failOldest() {
		const entry = pending.find((candidate) => candidate.status === "pending");
		if (!entry) {
			return null;
		}
		entry.reject(new Error(`manual failure for ${entry.requestId}`));
		return { requestId: entry.requestId, prefix: entry.prefix };
	}

	function snapshot() {
		return pending.map((entry) => ({
			requestId: entry.requestId,
			prefix: entry.prefix,
			status: entry.status,
			aborted: entry.signal.aborted,
		}));
	}

	return { search, finishOldest, failOldest, snapshot };
}
