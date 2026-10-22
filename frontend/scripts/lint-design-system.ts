import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

/** Check concrete style contracts, not React abstraction choices or layout. */
export function designSystemWarnings(path: string, source: string): string[] {
	if (/\.(?:test|spec)\.|\.d\.ts$/.test(path)) return [];
	const warnings: string[] = [];
	const warn = (offset: number, message: string) => {
		const line = source.slice(0, offset).split("\n").length;
		warnings.push(`${path}:${line}: design-system: ${message}`);
	};
	if (path.endsWith(".css")) {
		if (!path.startsWith("src/styles/")) {
			postcss.parse(source, { from: path }).walkAtRules("apply", (rule) => {
				warn(
					rule.source?.start?.offset ?? 0,
					"Export a utility recipe instead of a component @apply selector API.",
				);
			});
		}
		return warnings;
	}
	if (!/\.tsx?$/.test(path)) return warnings;
	for (const match of source.matchAll(/\[[^\s"`]*\]/g)) {
		if (
			match[0].includes("&") &&
			/(?:^|[[&_:>(+~])\.[a-zA-Z][\w-]*/.test(match[0])
		)
			warn(
				match.index,
				"Use native state or an explicit component slot instead of a private class selector.",
			);
	}
	for (const match of source.matchAll(
		/\b(?:bg|text|border|fill|stroke|outline|ring|accent|from|via|to)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+\b/g,
	)) {
		warn(
			match.index,
			"Use a semantic color token. Define palette choices in tokens.css or themes.css.",
		);
	}
	return warnings;
}

if (import.meta.main) {
	const root = fileURLToPath(new URL("../src/", import.meta.url));
	let count = 0;
	for (const path of readdirSync(root, {
		recursive: true,
		encoding: "utf8",
	}).sort()) {
		if (!/\.(?:css|tsx?)$/.test(path)) continue;
		const warnings = designSystemWarnings(
			`src/${path.replaceAll("\\", "/")}`,
			readFileSync(resolve(root, path), "utf8"),
		);
		for (const warning of warnings) console.warn(warning);
		count += warnings.length;
	}
	console.log(`Found ${count} design-system violation(s).`);
	if (count) process.exitCode = 1;
}
