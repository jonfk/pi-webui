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
