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
