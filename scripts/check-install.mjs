#!/usr/bin/env node
// Fail fast when a package manifest, the lockfile, and node_modules disagree.
// A stale install turns every later gate red with confusing errors, and
// oxlint cannot detect it because it does not resolve imports.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sections = ["dependencies", "devDependencies", "optionalDependencies"];

function declaredFrom(source) {
	return Object.assign({}, ...sections.map((section) => source[section] ?? {}));
}

function resolvedVersion(lock, name) {
	const entry = lock.packages?.[name]?.[0];
	if (typeof entry !== "string") return null;
	return entry.slice(entry.lastIndexOf("@") + 1);
}

function isInstalled(dir, name) {
	return existsSync(join(dir, "node_modules", ...name.split("/"), "package.json"));
}

function installedVersion(dir, name) {
	const manifest = JSON.parse(
		readFileSync(join(dir, "node_modules", ...name.split("/"), "package.json"), "utf8"),
	);
	return manifest.version;
}

let failed = false;

const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const workspaces = rootManifest.workspaces ?? [];
const lockPath = join(root, "bun.lock");

if (!existsSync(lockPath)) {
	console.error("check-install: missing bun.lock; run bun install");
	process.exit(1);
}
let lock;
try {
	// bun.lock is JSONC: plain JSON plus trailing commas.
	const text = readFileSync(lockPath, "utf8").replace(/,(\s*[}\]])/g, "$1");
	lock = JSON.parse(text);
} catch {
	console.error("check-install: bun.lock is unreadable; run bun install");
	process.exit(1);
}

for (const workspace of workspaces) {
	const dir = join(root, workspace);
	const manifestPath = join(dir, "package.json");

	if (!existsSync(manifestPath)) {
		console.error(`check-install: ${workspace}: missing package.json`);
		failed = true;
		continue;
	}

	const manifest = declaredFrom(JSON.parse(readFileSync(manifestPath, "utf8")));
	const locked = declaredFrom(lock.workspaces?.[workspace] ?? {});
	const missingModules = !existsSync(join(dir, "node_modules"));

	if (missingModules) {
		console.error(
			`check-install: ${workspace}: node_modules is not installed; run bun install`,
		);
		failed = true;
		continue;
	}

	for (const [name, range] of Object.entries(manifest)) {
		if (locked[name] !== range) {
			console.error(
				`check-install: ${workspace}: package.json declares ${name}@${range} but bun.lock has ${locked[name] ?? "nothing"}; run bun install`,
			);
			failed = true;
			continue;
		}

		if (!isInstalled(dir, name)) {
			console.error(
				`check-install: ${workspace}: ${name} is missing from node_modules; run bun install`,
			);
			failed = true;
			continue;
		}

		const expected = resolvedVersion(lock, name);
		const actual = installedVersion(dir, name);
		if (expected && actual !== expected) {
			console.error(
				`check-install: ${workspace}: node_modules has ${name}@${actual} but bun.lock has ${expected}; run bun install`,
			);
			failed = true;
		}
	}
}

if (failed) process.exit(1);
