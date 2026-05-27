# pi-webui

a simple, standalone webui for [pi.dev](https://pi.dev)

![screencast](docs/screencast.gif)

## getting started

prerequisites:

- node.js 20+
- a working pi installation

install as a pi extension:

```bash
pi install npm:@khimaros/pi-webui
```

control from the pi tui:

```bash
> /webui start    # start the server
> /webui status   # view server status
> /webui open     # open webui in browser
> /webui stop     # stop the server
```

or auto-start when pi launches (server is terminated when pi exits):

```bash
pi --webui                              # start with defaults
pi --webui-listen 0.0.0.0:3000          # start with a custom bind address
```

run without installing:

```bash
npx @khimaros/pi-webui
```

or install globally:

```bash
npm install -g @khimaros/pi-webui
pi-webui
```

then open <http://127.0.0.1:4096>.

### from a source checkout

```bash
make            # install deps + build (tsc)
make start      # run the server
make test       # build + run tests
```

## configuration

command-line flags:

| flag | purpose |
| --- | --- |
| `--listen <host:port>` | http bind address; takes precedence over `HOST`/`PORT`. use `:port` for default host, or `[::1]:port` for ipv6. |

environment variables:

| variable | default | purpose |
| --- | --- | --- |
| `PI_WEBUI_HOST` | `127.0.0.1` | http bind address |
| `PI_WEBUI_PORT` | `4096` | http port |
| `PI_AGENT_DIR` | pi default (`~/.pi/agent`) | pi agent config directory |
| `PI_SESSION_DIR` | pi default | session storage directory |
| `PI_WEBUI_CWD_ALLOW_ANY` | `0` | allow `/cwd` to switch to paths outside `$HOME` |

workspace shortcuts and the last cwd are persisted in `PI_AGENT_DIR/workspaces.json`.

| slash command | purpose |
| --- | --- |
| `/workspace` | open the saved workspace picker |
| `/workspace <name-or-path>` | switch to a saved workspace |
| `/workspace-add <path> [name]` | save a workspace path, defaulting the name to the directory basename |
| `/workspace-remove <name-or-path>` | remove a saved workspace |

examples:

```bash
pi-webui --listen 0.0.0.0:3000
PI_WEBUI_HOST=0.0.0.0 PI_WEBUI_PORT=3000 npm start
```

## attachments

paste images into the composer (Ctrl/Cmd+V) or drag and drop them onto the
window. thumbnails appear above the input and ride along with the next
prompt. up to 8 images per turn, 10 MB each. PNG, JPEG, GIF, and WebP are
accepted.

## roadmap

see [ROADMAP.md](ROADMAP.md) for implemented and planned features.

## architecture

```
src/
  extension/   pi extension entry (slash command + auto-start flag)
  server/      http + websocket server hosting the pi sdk runtime
                 index.ts, event-log.ts, log.ts, watch.ts, ext-ui.ts
public/        browser client (vanilla js, no build step)
test/          node --test files
```

## development

```bash
make            # install deps + build (tsc)
make start      # run the server
make install    # install pi-webui globally from this checkout
make update     # update dependencies (npm update)
make test       # build + run tests
make lint       # tsc --noEmit + node --check on .mjs sources
make precommit  # lint + test
make vendor     # refresh public/vendor (marked, highlight.js)
make clean      # rm -rf dist build
```
