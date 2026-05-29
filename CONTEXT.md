# pi-webui

This project browser based web frontend for working with pi coding agent sessions across workspaces.

## Language

**Skill Command**:
A slash command named `skill:{name}` that invokes a discovered pi skill through the session prompt path.
_Avoid_: skill launcher, skill shortcut

**Slash Command Catalog**:
The set of slash commands surfaced by a UI for autocomplete and command discovery.
_Avoid_: command list, slash menu data

**Prompt Command**:
A slash command backed by a pi prompt template and labeled with source `prompt`.
_Avoid_: template command

**Unsupported Slash Command**:
A known slash command that pi-webui surfaces for discovery but cannot execute in the browser UI.
_Avoid_: hidden command, disabled command

**Slash Command Refresh**:
A server-to-client update that replaces the browser's current **Slash Command Catalog** after session resources may have changed.
_Avoid_: command reload, menu refresh

**Slash Command Module**:
The server module that builds the **Slash Command Catalog** and classifies slash command invocations for web dispatch.
_Avoid_: slash command helper, command utility

**URL Session Pointer**:
A URL value that names the Pi session pi-webui should open for the current browser tab.
_Avoid_: active session storage, selected session localStorage

**URL Cwd Pointer**:
A URL value that names the working directory where new Pi sessions start.
_Avoid_: cwd storage, initial cwd localStorage

**New Session Cwd Mode**:
URL state where pi-webui has cwd intent but no durable Pi session identity yet.
_Avoid_: disposable cwd, ephemeral cwd

**Invalid Session Message**:
A frontend pseudo message that explains why the current URL session or cwd state cannot be opened.
_Avoid_: invalid session page, invalid session toast

**URL Transition Intent**:
The browser-side intent that decides whether ordered session updates should become a **URL Session Pointer** or a **URL Cwd Pointer**.
_Avoid_: raw session_state sync, URL side effect flag

## Relationships

- A **Slash Command Catalog** may include **Skill Commands** when pi skill commands are enabled.
- A **Slash Command Catalog** labels pi prompt templates as **Prompt Commands** using source `prompt`.
- A **Skill Command** is invoked through the existing session prompt path so pi owns skill expansion.
- An **Unsupported Slash Command** remains visible in the **Slash Command Catalog** with `supported: false`.
- A **Slash Command Refresh** keeps the browser's **Slash Command Catalog** aligned with the active session resources.
- The **Slash Command Module** owns catalog construction and dispatch classification for slash commands in pi-webui, but command execution remains with the session controller.
- A **URL Session Pointer** is scoped to one browser tab and replaces browser-local active-session storage for choosing the active Pi session.
- **New Session Cwd Mode** is selected by a **URL Cwd Pointer** and becomes a normal **URL Session Pointer** only after Pi accepts the first prompt.
- An **Invalid Session Message** is shown instead of bootstrapping a fallback session when URL session or cwd state cannot be opened.
- **URL Transition Intent** prevents transient `session_state` packets from creating browser history entries before command-specific URL policy runs.

## Example Dialogue

> **Dev:** "Should pi-webui expand a **Skill Command** itself?"
> **Domain expert:** "No. pi-webui should submit it through the session prompt path, matching the TUI, so pi owns the expansion."

> **Dev:** "Should an empty session opened from `/new` preserve its session file in the URL before the first prompt?"
> **Domain expert:** "No. It is in **New Session Cwd Mode** until Pi accepts the first prompt."

> **Dev:** "Should a deleted **URL Session Pointer** fall back to the default session?"
> **Domain expert:** "No. Show an **Invalid Session Message** so the user does not accidentally type into the wrong Pi session."
