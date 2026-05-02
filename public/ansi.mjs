// Minimal ANSI SGR -> HTML converter for pi-tui Component output.
//
// Pi-tui themes emit SGR sequences via the `theme.fg/bg/bold` helpers using
// either the 16-color palette, 256-color (38;5;n) or truecolor (38;2;r;g;b)
// modes. We support all of those plus the common attribute toggles. Anything
// we don't understand (cursor moves, OSC, etc.) is silently dropped — the
// modal isn't a real terminal, so positioning escapes have no meaning.

const ESC = "\x1b";

const ANSI_16 = [
  "#000000", "#cd0000", "#00cd00", "#cdcd00",
  "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5",
  "#7f7f7f", "#ff0000", "#00ff00", "#ffff00",
  "#5c5cff", "#ff00ff", "#00ffff", "#ffffff",
];

function color256(n) {
  if (n < 16) return ANSI_16[n];
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  const idx = n - 16;
  const r = Math.floor(idx / 36);
  const g = Math.floor((idx % 36) / 6);
  const b = idx % 6;
  const map = [0, 95, 135, 175, 215, 255];
  return `rgb(${map[r]},${map[g]},${map[b]})`;
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// State machine: walk the string; on SGR boundaries flush text with current
// style as a span; track open state across boundaries.
export function ansiToHtml(text) {
  if (!text) return "";
  let out = "";
  let buf = "";
  let style = newStyle();
  let openSpan = false;

  const flush = () => {
    if (!buf) return;
    if (openSpan) {
      out += `<span style="${styleToCss(style)}">${escapeHtml(buf)}</span>`;
    } else {
      out += escapeHtml(buf);
    }
    buf = "";
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ESC && text[i + 1] === "[") {
      flush();
      // Scan to the CSI final byte (0x40-0x7E). SGR ends in 'm'; other CSIs
      // end in different letters and we silently drop them.
      let end = i + 2;
      while (end < text.length) {
        const code = text.charCodeAt(end);
        if (code >= 0x40 && code <= 0x7e) break;
        end += 1;
      }
      if (end >= text.length) {
        // truncated — give up on the rest
        i = text.length;
        continue;
      }
      if (text[end] === "m") {
        applySgr(style, text.slice(i + 2, end));
        openSpan = !isStyleEmpty(style);
      }
      i = end + 1;
      continue;
    }
    if (ch === ESC) {
      // Bare ESC or unsupported sequence; skip just the ESC and let the next
      // iteration attempt to interpret what follows.
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

function newStyle() {
  return { fg: null, bg: null, bold: false, italic: false, underline: false, inverse: false, strike: false };
}

function isStyleEmpty(s) {
  return !s.fg && !s.bg && !s.bold && !s.italic && !s.underline && !s.inverse && !s.strike;
}

function styleToCss(s) {
  const parts = [];
  const fg = s.inverse ? (s.bg || "#ffffff") : s.fg;
  const bg = s.inverse ? (s.fg || "transparent") : s.bg;
  if (fg) parts.push(`color:${fg}`);
  if (bg) parts.push(`background:${bg}`);
  if (s.bold) parts.push("font-weight:bold");
  if (s.italic) parts.push("font-style:italic");
  if (s.underline || s.strike) {
    const decos = [];
    if (s.underline) decos.push("underline");
    if (s.strike) decos.push("line-through");
    parts.push(`text-decoration:${decos.join(" ")}`);
  }
  return parts.join(";");
}

function applySgr(style, params) {
  const codes = params.split(";").map((p) => (p === "" ? 0 : Number(p)));
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    switch (true) {
      case c === 0:
        Object.assign(style, newStyle());
        break;
      case c === 1: style.bold = true; break;
      case c === 22: style.bold = false; break;
      case c === 3: style.italic = true; break;
      case c === 23: style.italic = false; break;
      case c === 4: style.underline = true; break;
      case c === 24: style.underline = false; break;
      case c === 7: style.inverse = true; break;
      case c === 27: style.inverse = false; break;
      case c === 9: style.strike = true; break;
      case c === 29: style.strike = false; break;
      case c === 39: style.fg = null; break;
      case c === 49: style.bg = null; break;
      case c >= 30 && c <= 37: style.fg = ANSI_16[c - 30]; break;
      case c >= 40 && c <= 47: style.bg = ANSI_16[c - 40]; break;
      case c >= 90 && c <= 97: style.fg = ANSI_16[c - 90 + 8]; break;
      case c >= 100 && c <= 107: style.bg = ANSI_16[c - 100 + 8]; break;
      case c === 38 || c === 48: {
        const target = c === 38 ? "fg" : "bg";
        const mode = codes[i + 1];
        if (mode === 5 && codes[i + 2] !== undefined) {
          style[target] = color256(codes[i + 2]);
          i += 2;
        } else if (mode === 2 && codes[i + 4] !== undefined) {
          style[target] = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
          i += 4;
        } else {
          // unknown extended-color form; skip the introducer
          i += 1;
        }
        break;
      }
      default:
        // ignore unknown SGR codes
        break;
    }
  }
}
