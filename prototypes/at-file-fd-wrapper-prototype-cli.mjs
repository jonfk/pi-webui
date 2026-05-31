#!/usr/bin/env node

// PROTOTYPE - terminal driver for the backend fd wrapper.

import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildSearchPlan, searchFileCompletions } from "./at-file-fd-wrapper-prototype.mjs";

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";

async function createFixture() {
	const container = await mkdtemp(path.join(tmpdir(), "pi-webui-at-fd-prototype-wipe-me-"));
	const root = path.join(container, "workspace");
	await mkdir(path.join(root, "src", "nested"), { recursive: true });
	await mkdir(path.join(root, "my folder"), { recursive: true });
	await mkdir(path.join(root, ".hidden-dir"), { recursive: true });
	await mkdir(path.join(root, ".git", "objects"), { recursive: true });
	await mkdir(path.join(container, "sibling-workspace"), { recursive: true });
	await writeFile(path.join(root, "README.md"), "prototype fixture\n");
	await writeFile(path.join(root, "src", "app.js"), "console.log('fixture')\n");
	await writeFile(path.join(root, "src", "nested", "route.ts"), "export {}\n");
	await writeFile(path.join(root, "my folder", "space file.txt"), "spaces\n");
	await writeFile(path.join(root, ".hidden-file"), "hidden\n");
	await writeFile(path.join(root, ".hidden-dir", "secret.txt"), "secret\n");
	await writeFile(path.join(root, ".git", "config"), "ignored\n");
	await writeFile(path.join(container, "sibling-workspace", "outside.txt"), "outside\n");
	try {
		await symlink(path.join(root, "src"), path.join(root, "src-link"));
	} catch {
		// Some environments disallow symlinks; the rest of the prototype still answers the wrapper question.
	}
	return { container, cwd: root };
}

function quietLogger() {
	return {
		error(message, fields) {
			console.error(`${message}${fields ? ` ${JSON.stringify(fields)}` : ""}`);
		},
	};
}

async function renderScenario({ cwd, prefix, limit }) {
	const controller = new AbortController();
	const plan = buildSearchPlan({ cwd, prefix });
	const items = await searchFileCompletions({
		cwd,
		prefix,
		signal: controller.signal,
		limit,
		logger: quietLogger(),
	});

	console.log(`${bold}Prefix${reset}: ${prefix}`);
	console.log(`${bold}Search plan${reset}:`);
	console.log(JSON.stringify(plan, null, 2));
	console.log(`${bold}Items${reset}:`);
	console.log(JSON.stringify(items, null, 2));
	console.log("");
}

async function main() {
	const fixture = await createFixture();
	const cwd = fixture.cwd;
	const scenarios = [
		"@",
		"@src",
		"@src/",
		'@"my folder/s',
		"@.hidden",
		"@../sibling-workspace/out",
		`@${path.join(cwd, "src")}/app`,
	];

	console.log(`${bold}pi-webui backend fd wrapper prototype${reset}`);
	console.log(`${dim}Question: can the backend turn user-visible @ prefixes into insert-ready fd results?${reset}`);
	console.log(`${bold}Fixture cwd${reset}: ${cwd}`);
	console.log(`${bold}Home prefix note${reset}: try a manual prefix such as @~/ against your real home if needed.`);
	console.log("");

	try {
		const requestedPrefix = process.argv[2];
		if (requestedPrefix) {
			await renderScenario({ cwd, prefix: requestedPrefix, limit: 10 });
			return;
		}

		for (const prefix of scenarios) {
			await renderScenario({ cwd, prefix, limit: 10 });
		}
	} finally {
		await rm(fixture.container, { recursive: true, force: true });
	}
}

await main();
