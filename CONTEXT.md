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

## Relationships

- A **Slash Command Catalog** may include **Skill Commands** when pi skill commands are enabled.
- A **Slash Command Catalog** labels pi prompt templates as **Prompt Commands** using source `prompt`.
- A **Skill Command** is invoked through the existing session prompt path so pi owns skill expansion.
- An **Unsupported Slash Command** remains visible in the **Slash Command Catalog** with `supported: false`.
- A **Slash Command Refresh** keeps the browser's **Slash Command Catalog** aligned with the active session resources.
- The **Slash Command Module** owns catalog construction and dispatch classification for slash commands in pi-webui, but command execution remains with the session controller.

## Example Dialogue

> **Dev:** "Should pi-webui expand a **Skill Command** itself?"
> **Domain expert:** "No. pi-webui should submit it through the session prompt path, matching the TUI, so pi owns the expansion."
