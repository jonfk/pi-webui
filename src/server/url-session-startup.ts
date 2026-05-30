import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

export function validateSessionPointer(sessionPath: string): { ok: true } | { ok: false; reason: string } {
  if (!sessionPath) return { ok: false, reason: "path is required" };
  if (!isAbsolute(sessionPath)) return { ok: false, reason: "path must be absolute" };
  if (!existsSync(sessionPath)) return { ok: false, reason: `path does not exist: ${sessionPath}` };
  if (!statSync(sessionPath).isFile()) return { ok: false, reason: `not a file: ${sessionPath}` };

  const firstLine = readFirstLine(sessionPath);
  if (!firstLine) return { ok: false, reason: "session file is empty" };

  let header: unknown;
  try {
    header = JSON.parse(firstLine);
  } catch {
    return { ok: false, reason: "first line is not valid JSON" };
  }

  if (!header || typeof header !== "object" || (header as { type?: unknown }).type !== "session") {
    return { ok: false, reason: "missing session header" };
  }
  if (typeof (header as { id?: unknown }).id !== "string" || !(header as { id: string }).id) {
    return { ok: false, reason: "session header id is required" };
  }
  if (typeof (header as { cwd?: unknown }).cwd !== "string" || !(header as { cwd: string }).cwd) {
    return { ok: false, reason: "session header cwd is required" };
  }

  return { ok: true };
}

function readFirstLine(path: string): string {
  const fd = openSync(path, "r");
  try {
    const chunks: Buffer[] = [];
    const buffer = Buffer.alloc(4096);
    let offset = 0;
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, offset);
      if (bytesRead === 0) break;
      const slice = buffer.subarray(0, bytesRead);
      const newline = slice.indexOf(10);
      if (newline !== -1) {
        chunks.push(slice.subarray(0, newline));
        break;
      }
      chunks.push(Buffer.from(slice));
      offset += bytesRead;
    }
    return Buffer.concat(chunks).toString("utf8").replace(/\r$/, "");
  } finally {
    closeSync(fd);
  }
}
