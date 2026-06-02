import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseAtFilePrefix } from "../../public/file-completion-grammar.mjs";

const FD_EXECUTABLE = "fd";
const DEFAULT_LIMIT = 20;
const DEFAULT_TIMEOUT_MS = 750;

export type FileCompletionItem = {
  insertText: string;
  label: string;
  description: string;
  isDirectory: boolean;
  addsTrailingSpace: boolean;
  cursorOffset: number;
  replaceFollowingText?: string;
};

type Logger = {
  error: (message: string, fields?: Record<string, unknown>) => void;
  warn?: (message: string, fields?: Record<string, unknown>) => void;
};

type SearchPlan = {
  kind: "scoped" | "fullPathFuzzy";
  rawPrefix: string;
  isQuotedPrefix: boolean;
  baseDir: string;
  displayBase: string;
  query: string;
};

export type SearchFileCompletionOptions = {
  cwd: string;
  homeDir: string;
  prefix: string;
  signal?: AbortSignal;
  limit?: number;
  timeoutMs?: number;
  logger?: Logger;
};

function toDisplayPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFdPathQuery(query: string): string {
  const normalized = toDisplayPath(query);
  if (!normalized.includes("/")) {
    return escapeRegex(normalized);
  }

  const hasTrailingSeparator = normalized.endsWith("/");
  const trimmed = normalized.replace(/^\/+|\/+$/g, "");
  if (!trimmed) {
    return normalized;
  }

  const separatorPattern = "[\\\\/]";
  const segments = trimmed.split("/").filter(Boolean).map(escapeRegex);
  let pattern = segments.join(separatorPattern);
  if (hasTrailingSeparator) {
    pattern += separatorPattern;
  }
  return pattern;
}

function expandHomePath(homeDir: string, rawPath: string): string {
  if (rawPath === "~") {
    return homeDir;
  }
  if (rawPath.startsWith("~/")) {
    return join(homeDir, rawPath.slice(2));
  }
  return rawPath;
}

export function buildFileCompletionSearchPlan({
  cwd,
  homeDir,
  prefix,
}: {
  cwd: string;
  homeDir: string;
  prefix: string;
}): SearchPlan {
  const parsed = parseAtFilePrefix(prefix);
  const rawPrefix = toDisplayPath(parsed.rawPrefix);
  const expandedPrefix = expandHomePath(homeDir, rawPrefix);
  const slashIndex = rawPrefix.lastIndexOf("/");

  if (slashIndex === -1) {
    return {
      ...parsed,
      kind: "fullPathFuzzy",
      rawPrefix,
      baseDir: cwd,
      displayBase: "",
      query: rawPrefix,
    };
  }

  const displayBase = rawPrefix.slice(0, slashIndex + 1);
  const query = rawPrefix.slice(slashIndex + 1);
  let baseDir: string;

  if (displayBase.startsWith("~/")) {
    baseDir = expandHomePath(homeDir, displayBase);
  } else if (displayBase.startsWith("/")) {
    baseDir = displayBase;
  } else {
    baseDir = resolve(cwd, expandedPrefix.slice(0, slashIndex + 1));
  }

  return {
    ...parsed,
    kind: "scoped",
    rawPrefix,
    baseDir,
    displayBase,
    query,
  };
}

async function pathIsDirectory(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function resolveSearchPlan(plan: SearchPlan, cwd: string): Promise<SearchPlan | null> {
  if (plan.kind === "fullPathFuzzy") {
    return (await pathIsDirectory(plan.baseDir)) ? plan : null;
  }

  if (await pathIsDirectory(plan.baseDir)) {
    return plan;
  }

  if (!(await pathIsDirectory(cwd))) {
    return null;
  }

  return {
    kind: "fullPathFuzzy",
    rawPrefix: plan.rawPrefix,
    isQuotedPrefix: plan.isQuotedPrefix,
    baseDir: cwd,
    displayBase: "",
    query: plan.rawPrefix,
  };
}

function scopedPathForDisplay(displayBase: string, relativePath: string): string {
  const normalizedRelativePath = toDisplayPath(relativePath).replace(/\/+$/g, "");
  if (!displayBase) {
    return normalizedRelativePath;
  }
  if (displayBase === "/") {
    return `/${normalizedRelativePath}`;
  }
  return `${toDisplayPath(displayBase)}${normalizedRelativePath}`;
}

function buildCompletionInsertion(
  completionPath: string,
  isDirectory: boolean,
  isQuotedPrefix: boolean,
): Pick<FileCompletionItem, "insertText" | "addsTrailingSpace" | "cursorOffset" | "replaceFollowingText"> {
  const addsTrailingSpace = !isDirectory;
  if (!isQuotedPrefix && !completionPath.includes(" ")) {
    const insertText = `@${completionPath}`;
    return {
      insertText,
      addsTrailingSpace,
      cursorOffset: insertText.length + (addsTrailingSpace ? 1 : 0),
    };
  }

  const insertText = `@"${completionPath}"`;
  return {
    insertText,
    addsTrailingSpace,
    cursorOffset: isDirectory ? insertText.length - 1 : insertText.length + (addsTrailingSpace ? 1 : 0),
    replaceFollowingText: '"',
  };
}

function scoreEntry(filePath: string, query: string, isDirectory: boolean): number {
  if (!query) {
    return isDirectory ? 2 : 1;
  }

  const fileName = basename(filePath);
  const lowerFileName = fileName.toLowerCase();
  const lowerPath = filePath.toLowerCase();
  const lowerQuery = query.toLowerCase();

  let score = 0;
  if (lowerFileName === lowerQuery) {
    score = 100;
  } else if (lowerFileName.startsWith(lowerQuery)) {
    score = 80;
  } else if (lowerFileName.includes(lowerQuery)) {
    score = 50;
  } else if (lowerPath.includes(lowerQuery)) {
    score = 30;
  }

  if (isDirectory && score > 0) {
    score += 10;
  }
  return score;
}

function isGitPath(relativePath: string): boolean {
  const normalizedPath = toDisplayPath(relativePath).replace(/\/+$/g, "");
  return normalizedPath === ".git" || normalizedPath.startsWith(".git/") || normalizedPath.includes("/.git/");
}

async function collectFdEntries({
  baseDir,
  query,
  signal,
  maxResults,
  timeoutMs,
  logger,
}: {
  baseDir: string;
  query: string;
  signal?: AbortSignal;
  maxResults: number;
  timeoutMs: number;
  logger: Logger;
}): Promise<Array<{ path: string; isDirectory: boolean }>> {
  const args = [
    "--base-directory",
    baseDir,
    "--max-results",
    String(maxResults),
    "--type",
    "f",
    "--type",
    "d",
    "--follow",
    "--hidden",
    "--exclude",
    ".git",
    "--exclude",
    ".git/*",
    "--exclude",
    ".git/**",
  ];

  if (toDisplayPath(query).includes("/")) {
    args.push("--full-path");
  }
  if (query) {
    args.push("--", buildFdPathQuery(query));
  }

  return await new Promise((resolveEntries) => {
    if (signal?.aborted) {
      resolveEntries([]);
      return;
    }

    const child = spawn(FD_EXECUTABLE, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let resolved = false;
    let timedOut = false;

    const finish = (entries: Array<{ path: string; isDirectory: boolean }>) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      resolveEntries(entries);
    };

    const killChild = () => {
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGKILL");
      }
    };

    const onAbort = () => {
      killChild();
      finish([]);
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      logger.warn?.("file completion fd search timed out", { baseDir, query, timeoutMs });
      killChild();
      finish([]);
    }, timeoutMs);

    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        logger.error("file completion fd executable not found", { executable: FD_EXECUTABLE });
      } else {
        logger.error("file completion fd failed to start", { error: error.message });
      }
      finish([]);
    });
    child.on("close", async (code) => {
      if (signal?.aborted || timedOut) {
        finish([]);
        return;
      }
      if (code !== 0) {
        const trimmedStderr = stderr.trim();
        if (trimmedStderr) {
          logger.error("file completion fd exited with an error", { code, stderr: trimmedStderr });
        }
        finish([]);
        return;
      }

      try {
        const entries = [];
        const lines = stdout.trim().split("\n").filter(Boolean).map(toDisplayPath);
        for (const line of lines) {
          const isDirectory = line.endsWith("/");
          const normalizedPath = line.replace(/\/+$/g, "");
          if (isGitPath(normalizedPath)) {
            continue;
          }
          entries.push({
            path: normalizedPath,
            isDirectory,
          });
        }
        finish(entries);
      } catch (error) {
        logger.error("file completion fd result processing failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        finish([]);
      }
    });
  });
}

export async function searchFileCompletions({
  cwd,
  homeDir,
  prefix,
  signal,
  limit = DEFAULT_LIMIT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = console,
}: SearchFileCompletionOptions): Promise<FileCompletionItem[]> {
  let plan: SearchPlan;
  try {
    plan = buildFileCompletionSearchPlan({ cwd, homeDir, prefix });
  } catch (error) {
    logger.error("file completion prefix parse failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  const resolvedPlan = await resolveSearchPlan(plan, cwd);
  if (!resolvedPlan) {
    return [];
  }
  plan = resolvedPlan;

  const entries = await collectFdEntries({
    baseDir: plan.baseDir,
    query: plan.query,
    signal,
    maxResults: limit * 5,
    timeoutMs,
    logger,
  });
  if (signal?.aborted) {
    return [];
  }

  return entries
    .map((entry) => ({
      ...entry,
      score: scoreEntry(entry.path, plan.query, entry.isDirectory),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((entry) => {
      const displayPath = scopedPathForDisplay(plan.displayBase, entry.path);
      const completionPath = entry.isDirectory ? `${displayPath}/` : displayPath;
      const insertion = buildCompletionInsertion(completionPath, entry.isDirectory, plan.isQuotedPrefix);
      const labelPath = entry.isDirectory ? displayPath : completionPath;

      return {
        ...insertion,
        label: `${basename(labelPath)}${entry.isDirectory ? "/" : ""}`,
        description: displayPath,
        isDirectory: entry.isDirectory,
      };
    });
}
