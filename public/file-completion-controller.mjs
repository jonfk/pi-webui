import { findAtFileCompletionContext } from "./file-completion-grammar.mjs";

const FILE_COMPLETION_KEYS = new Set(["ArrowDown", "ArrowUp", "Tab", "Escape"]);

export function findAtCompletionContext(text, cursorIndex, selectionEnd = cursorIndex) {
  return findAtFileCompletionContext(text, cursorIndex, selectionEnd);
}

export function applyAtCompletion(text, cursorIndex, context, item) {
  if (!context) {
    throw new Error("Cannot apply a completion without an @ context");
  }

  const beforePrefix = text.slice(0, context.startIndex);
  const afterCursor = text.slice(cursorIndex);
  const followingText = item.replaceFollowingText ?? "";
  const adjustedAfterCursor =
    context.isQuoted && followingText && afterCursor.startsWith(followingText)
      ? afterCursor.slice(followingText.length)
      : afterCursor;

  const suffix = item.addsTrailingSpace ? " " : "";
  const insertedValue = item.insertText + suffix;
  const nextText = beforePrefix + insertedValue + adjustedAfterCursor;

  return {
    text: nextText,
    cursorIndex: beforePrefix.length + item.cursorOffset,
  };
}

export function createFileCompletionController({
  input,
  menu,
  sendRequest,
  debounceMs = 100,
  onApply = () => {},
}) {
  return new FileCompletionController({ input, menu, sendRequest, debounceMs, onApply });
}

class FileCompletionController {
  constructor({ input, menu, sendRequest, debounceMs, onApply }) {
    this.input = input;
    this.menu = menu;
    this.sendRequest = sendRequest;
    this.debounceMs = debounceMs;
    this.onApply = onApply;
    this.active = null;
    this.menuState = null;
    this.nextRequestNumber = 1;
  }

  onInputChanged() {
    const context = findAtCompletionContext(
      this.input.value,
      this.input.selectionStart,
      this.input.selectionEnd,
    );

    this.close("input_changed");
    if (!context) {
      return;
    }

    const requestId = `file-${this.nextRequestNumber}`;
    this.nextRequestNumber += 1;
    const active = {
      requestId,
      context,
      timer: null,
    };
    active.timer = setTimeout(() => {
      active.timer = null;
      this.sendRequest({ type: "file_completion_request", requestId, prefix: context.prefix });
    }, this.debounceMs);
    this.active = active;
  }

  onCursorChanged() {
    if (!this.isOpen()) return;
    const context = findAtCompletionContext(
      this.input.value,
      this.input.selectionStart,
      this.input.selectionEnd,
    );
    if (!context || context.prefix !== this.active?.context.prefix) {
      this.close("context_changed");
      return;
    }
    this.active.context = context;
  }

  handleResult(payload) {
    if (!payload || payload.requestId !== this.active?.requestId) return;

    const context = findAtCompletionContext(
      this.input.value,
      this.input.selectionStart,
      this.input.selectionEnd,
    );
    if (!context || context.prefix !== payload.prefix) {
      this.close("context_changed");
      return;
    }

    this.active.context = context;
    this.menuState = { items: payload.items, selectedIndex: 0 };
    if (this.menuState.items.length === 0) {
      this.close("empty");
      return;
    }

    this.render();
  }

  handleKeydown(event) {
    if (!this.isOpen()) return false;
    if (FILE_COMPLETION_KEYS.has(event.key)) {
      event.preventDefault();
    } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
    } else {
      return false;
    }

    if (event.key === "ArrowDown") {
      this.menuState.selectedIndex = (this.menuState.selectedIndex + 1) % this.menuState.items.length;
      this.render();
      return true;
    }
    if (event.key === "ArrowUp") {
      this.menuState.selectedIndex =
        (this.menuState.selectedIndex - 1 + this.menuState.items.length) % this.menuState.items.length;
      this.render();
      return true;
    }
    if (event.key === "Escape") {
      this.close("escape");
      return true;
    }
    if (event.key === "Tab" || event.key === "Enter") {
      this.applySelected();
      return true;
    }

    return false;
  }

  close(_reason = "closed") {
    const active = this.active;
    const shouldCancelBackend = this.shouldCancelBackend(active);
    this.clearActiveTimer();
    this.active = null;
    this.menuState = null;
    this.menu.hidden = true;
    this.menu.replaceChildren();
    if (shouldCancelBackend) {
      this.sendRequest({ type: "file_completion_cancel", requestId: active.requestId });
    }
  }

  isOpen() {
    return !this.menu.hidden && (this.menuState?.items.length ?? 0) > 0;
  }

  applySelected() {
    const item = this.menuState?.items[this.menuState.selectedIndex];
    const context = findAtCompletionContext(
      this.input.value,
      this.input.selectionStart,
      this.input.selectionEnd,
    );
    if (!context || !item) {
      this.close("apply_context_missing");
      return;
    }

    const next = applyAtCompletion(this.input.value, this.input.selectionStart, context, item);
    this.input.value = next.text;
    this.input.setSelectionRange(next.cursorIndex, next.cursorIndex);
    this.close("applied");
    this.input.focus();
    this.onApply();
  }

  render() {
    this.menu.replaceChildren();
    const menuState = this.menuState;
    if (!menuState) {
      this.menu.hidden = true;
      return;
    }

    let activeEl = null;

    menuState.items.forEach((item, index) => {
      const el = document.createElement("div");
      el.className = `file-completion-item${index === menuState.selectedIndex ? " active" : ""}`;
      el.dataset.index = String(index);

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = item.label;

      const desc = document.createElement("span");
      desc.className = "desc";
      desc.textContent = item.description;

      el.append(name, desc);
      el.addEventListener("mousedown", (event) => {
        event.preventDefault();
        if (this.menuState) {
          this.menuState.selectedIndex = index;
        }
        this.applySelected();
      });
      this.menu.appendChild(el);
      if (index === menuState.selectedIndex) activeEl = el;
    });

    this.menu.hidden = menuState.items.length === 0;
    activeEl?.scrollIntoView({ block: "nearest" });
  }

  clearActiveTimer() {
    if (!this.active?.timer) return;
    clearTimeout(this.active.timer);
    this.active.timer = null;
  }

  shouldCancelBackend(active) {
    return Boolean(active && active.timer === null);
  }
}
