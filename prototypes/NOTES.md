# PROTOTYPE - @ File Completion Text Parser Notes

Question: can Pi TUI's `@` file completion token parsing and replacement behavior be adapted to pi-webui textarea text using full text plus cursor offset?

Run it with:

```sh
npm run prototype:at-file-parser
```

Or use the interactive typing prototype:

```sh
npm run prototype:at-file-parser:interactive
```

Verdict placeholder:

- The prototype uses the current textarea line before the cursor, so newline boundaries behave like Pi TUI's per-line parser without converting the whole textarea into line/column form.
- The interactive prototype uses mocked ready-to-insert items so replacement behavior can be driven by hand before the backend `fd` wrapper exists.
- Fill in the final decision after driving the scenarios by hand, then delete this prototype or lift the pure module into the real `public/file-completion-controller.mjs` work.

## PROTOTYPE - Backend `fd` Wrapper Notes

Question: can the backend accept the user-visible `@` prefix, run exactly `fd`, and return ready-to-insert completion items while preserving relative, absolute, `~/`, `../`, hidden, quoted, directory, and symlink behavior close to Pi TUI?

Run it with:

```sh
npm run prototype:at-file-fd
```

Run one prefix against the generated fixture workspace:

```sh
npm run prototype:at-file-fd -- '@"my folder/s'
```

Verdict:

- The backend `fd` wrapper approach is viable.
- The prototype keeps the wrapper out of `src/server/index.ts` and exposes the expected production shape as `searchFileCompletions({ cwd, prefix, signal, limit })`.
- It can accept the frontend's user-visible `@` prefix, spawn executable name exactly `fd`, and return insert-ready values such as `@src/`, `@"my folder/space file.txt"`, and `@../sibling-workspace/outside.txt`.
- It validated bare `@` results, directory trailing `/`, quoted paths with spaces, relative path preservation, absolute path preservation, `../` preservation, hidden paths, `.git` exclusion, symlink following, and missing-`fd` behavior.
- Production code should normalize `fd` output before appending directory slashes because `fd` may already emit directories with trailing `/`.
- `~/` handling still needs either a controlled fake-home test or a manual smoke test before final production integration.
- Next step: lift the validated module shape into `src/server/file-completion.ts` or delete this prototype once the production wrapper exists.

## PROTOTYPE - One Active Search Per Websocket Notes

Question: what state should a websocket controller keep so a new `file_completion_request` aborts the previous search, socket close aborts current work, and only the still-current `requestId` can emit `file_completion_result`?

Run it with:

```sh
npm run prototype:at-file-active-search
```

Suggested driving sequence:

```text
r       start req-1
] r     start req-2, aborting req-1
f       try resolving the oldest still-pending search
f       resolve req-2
r c f   start req-3, close socket, then try resolving pending work
```

Verdict:

- The production controller only needs one per-websocket slot: `{ sequence, requestId, prefix, abortController }`.
- Starting a new request should abort and clear the old slot before creating the new slot.
- Search completion should emit only when the saved slot object is still current, the signal is not aborted, and the websocket is still open.
- Socket close should abort the active slot and prevent later requests/results.
- A scripted overlap smoke test confirmed that replacing `req-1` with `req-2` only emits `req-2`.
- A scripted close smoke test confirmed that closing the websocket aborts current work, suppresses late settlement, and ignores later requests.
- Fill in the final decision after driving the prototype, then delete this terminal shell or lift the controller shape into `src/server/index.ts`.

## PROTOTYPE - Websocket Contract Notes

Question: can the browser and server exchange `file_completion_request` / `file_completion_result` packets while keeping one active search per websocket and ignoring stale result packets on the frontend?

Run it with:

```sh
npm run prototype:at-file-ws-contract
```

Verdict:

- The request/result contract shape is viable:
  - request: `{ type: "file_completion_request", requestId, prefix }`
  - result: `{ type: "file_completion_result", payload: { requestId, prefix, items } }`
- The server integration can stay thin: parse the inbound packet, validate that it has a non-empty `requestId` and an `@` prefix, then delegate to the one-active-search controller.
- A new request aborts the previous websocket-local search before starting the next one.
- Only the current search emits a websocket result. The scripted overlap sends `req-1` for `@slow-src`, replaces it with `req-2` for `@src`, and the server emits only `req-2`.
- The client still needs its own `currentRequestId` guard because stale packets can arrive from reconnects, future bugs, or reordered experiments; the prototype injects a synthetic stale `req-1` packet and the client ignores it.
- Production wiring should put the server slot in `NativePiSessionController`, dispatch `file_completion_request` before the generic unknown-command branch, and route `file_completion_result` in `public/app.js` to the eventual `file-completion-controller.mjs`.

## PROTOTYPE - Frontend Controller Integration Notes

Question: can a separate file completion controller run before existing slash/history/submit key handling without refactoring slash completion?

Run it with:

```sh
npm run prototype:at-file-frontend
```

Suggested driving sequence:

```text
1       load "please inspect @src", flush request, deliver result
↓ Tab   move file selection and apply it
2 Tab   load "/mo" and verify slash completion still owns Tab
3 Enter load "/mo @src", deliver file results, verify Enter applies file completion instead of submitting
s       inject a stale file result and verify it is ignored
```

Verdict placeholder:

- The integration shape to validate is still `if (fileCompletionController.handleKeydown(event)) return;` before the existing slash/history/submit handling in `public/app.js`.
- File completion state stays separate from slash state: the prototype keeps independent menu state, selected indexes, pending request id, and request/result lifecycle.
- The file controller should own `ArrowUp`, `ArrowDown`, `Tab`, `Enter`, and `Escape` only while its menu is open; otherwise current slash completion, history navigation, and prompt submit behavior can stay in place.
- The frontend should keep a `currentRequestId` and also re-check the current textarea `@` context before opening the menu from a result.
- Reusing the existing slash menu styling is probably enough for the prototype, but production should use a separate element such as `#file-completion-menu` so slash and file state cannot fight over one DOM node.
- Fill in the final decision after driving the scenarios by hand, then delete this prototype or lift the controller shape into `public/file-completion-controller.mjs`.
