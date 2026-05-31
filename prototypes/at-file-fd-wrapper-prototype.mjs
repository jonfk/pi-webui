// PROTOTYPE - throwaway backend fd wrapper for pi-webui @ file completion.
//
// Question: can the backend accept the user-visible @ prefix, run exactly `fd`,
// and return insert-ready file completion items while preserving relative,
// absolute, ~/ and ../ input forms?

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const FD_EXECUTABLE = "fd";

function toDisplayPath(value) {
	return value.replace(/\\/g, "/");
}

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFdPathQuery(query) {
	const normalized = toDisplayPath(query);
	if (!normalized.includes("/")) {
		return normalized;
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

function parsePathPrefix(prefix) {
	if (prefix.startsWith('@"')) {
		return { rawPrefix: prefix.slice(2), isAtPrefix: true, isQuotedPrefix: true };
	}
	if (prefix.startsWith("@")) {
		return { rawPrefix: prefix.slice(1), isAtPrefix: true, isQuotedPrefix: false };
	}
	throw new Error(`Expected an @ prefix, got ${prefix}`);
}

function expandHomePath(rawPrefix) {
	if (rawPrefix === "~") {
		return homedir();
	}
	if (rawPrefix.startsWith("~/")) {
		return path.join(homedir(), rawPrefix.slice(2));
	}
	return rawPrefix;
}

function resolveScopedQuery(cwd, rawPrefix) {
	const normalizedPrefix = toDisplayPath(rawPrefix);
	const expandedPrefix = expandHomePath(normalizedPrefix);
	const slashIndex = normalizedPrefix.lastIndexOf("/");

	if (slashIndex === -1) {
		return {
			baseDir: cwd,
			displayBase: "",
			query: normalizedPrefix,
		};
	}

	const displayBase = normalizedPrefix.slice(0, slashIndex + 1);
	const query = normalizedPrefix.slice(slashIndex + 1);
	let baseDir;

	if (displayBase.startsWith("~/")) {
		baseDir = expandHomePath(displayBase);
	} else if (displayBase === "~") {
		baseDir = homedir();
	} else if (displayBase.startsWith("/")) {
		baseDir = displayBase;
	} else {
		baseDir = path.resolve(cwd, expandedPrefix.slice(0, slashIndex + 1));
	}

	return { baseDir, displayBase, query };
}

function scopedPathForDisplay(displayBase, relativePath) {
	const normalizedRelativePath = toDisplayPath(relativePath);
	if (!displayBase) {
		return normalizedRelativePath;
	}
	if (displayBase === "/") {
		return `/${normalizedRelativePath}`;
	}
	return `${toDisplayPath(displayBase)}${normalizedRelativePath}`;
}

function buildCompletionValue(completionPath, options) {
	const needsQuotes = options.isQuotedPrefix || completionPath.includes(" ");
	const prefix = options.isAtPrefix ? "@" : "";

	if (!needsQuotes) {
		return `${prefix}${completionPath}`;
	}

	return `${prefix}"${completionPath}"`;
}

function scoreEntry(filePath, query, isDirectory) {
	if (!query) {
		return isDirectory ? 2 : 1;
	}

	const fileName = path.basename(filePath);
	const lowerFileName = fileName.toLowerCase();
	const lowerQuery = query.toLowerCase();

	let score = 0;
	if (lowerFileName === lowerQuery) {
		score = 100;
	} else if (lowerFileName.startsWith(lowerQuery)) {
		score = 80;
	} else if (lowerFileName.includes(lowerQuery)) {
		score = 50;
	} else if (filePath.toLowerCase().includes(lowerQuery)) {
		score = 30;
	}

	if (isDirectory && score > 0) {
		score += 10;
	}
	return score;
}

async function pathIsDirectory(baseDir, relativePath) {
	const stats = await stat(path.join(baseDir, relativePath));
	return stats.isDirectory();
}

async function walkDirectoryWithFd({ baseDir, query, signal, maxResults, logger }) {
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
		".git/**",
	];

	if (toDisplayPath(query).includes("/")) {
		args.push("--full-path");
	}
	if (query) {
		args.push(buildFdPathQuery(query));
	}

	return await new Promise((resolve) => {
		if (signal?.aborted) {
			resolve([]);
			return;
		}

		const child = spawn(FD_EXECUTABLE, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let resolved = false;

		const finish = (results) => {
			if (resolved) return;
			resolved = true;
			signal?.removeEventListener("abort", onAbort);
			resolve(results);
		};

		const onAbort = () => {
			if (child.exitCode === null) {
				child.kill("SIGKILL");
			}
		};

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
			if (error.code === "ENOENT") {
				logger.error("file completion fd executable not found", { executable: FD_EXECUTABLE });
			} else {
				logger.error("file completion fd failed to start", { message: error.message });
			}
			finish([]);
		});
		child.on("close", async (code) => {
			if (signal?.aborted) {
				finish([]);
				return;
			}
			if (code !== 0) {
				if (stderr.trim()) {
					logger.error("file completion fd exited with an error", { code, stderr: stderr.trim() });
				}
				finish([]);
				return;
			}

			const lines = stdout.trim().split("\n").filter(Boolean).map(toDisplayPath);
			const results = [];
			for (const line of lines) {
				const normalizedLine = line.replace(/\/+$/g, "");
				if (normalizedLine === ".git" || normalizedLine.startsWith(".git/") || normalizedLine.includes("/.git/")) {
					continue;
				}
				results.push({
					path: normalizedLine,
					isDirectory: await pathIsDirectory(baseDir, normalizedLine),
				});
			}
			finish(results);
		});
	});
}

export function buildSearchPlan({ cwd, prefix }) {
	const parsed = parsePathPrefix(prefix);
	const scoped = resolveScopedQuery(cwd, parsed.rawPrefix);
	return { ...parsed, ...scoped };
}

export async function searchFileCompletions({ cwd, prefix, signal, limit = 20, logger = console }) {
	const plan = buildSearchPlan({ cwd, prefix });

	try {
		const stats = await stat(plan.baseDir);
		if (!stats.isDirectory()) {
			return [];
		}
	} catch {
		return [];
	}

	const entries = await walkDirectoryWithFd({
		baseDir: plan.baseDir,
		query: plan.query,
		signal,
		maxResults: limit * 5,
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
			const value = buildCompletionValue(completionPath, {
				isAtPrefix: plan.isAtPrefix,
				isQuotedPrefix: plan.isQuotedPrefix,
			});
			const pathWithoutSlash = entry.isDirectory ? displayPath : completionPath;

			return {
				value,
				label: `${path.basename(pathWithoutSlash)}${entry.isDirectory ? "/" : ""}`,
				description: displayPath,
				isDirectory: entry.isDirectory,
			};
		});
}
