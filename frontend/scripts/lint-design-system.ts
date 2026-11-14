import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

/**
 * Check concrete style contracts, not React abstraction choices or layout.
 *
 * Retired vocabulary (deleted modules, application token aliases, and
 * preset-ring suppression) is banned in app scopes. Official shadcn
 * primitives under src/components/ui/ are exempt: their resets (input-group
 * addon, checkbox field-label guard) and overlay tokens are stock.
 * Genuine browser chrome (native select pickers) and chart texture CSS are
 * exempt by pattern, not by file.
 */

/** Modules deleted in the shadcn adoption; import the ui primitive instead. */
const RETIRED_MODULE_PATTERN =
	/(?:from\s+["']|import\s+["'])[^"']*\/(buttonStyles|mergeStyles)(\.tsx?)?["']/g;
/** Recipe identifiers that only existed to serve the retired wrappers. */
const RETIRED_RECIPE_PATTERN =
	/(?<![\w$/])(buttonStyles|textButtonStyles|iconButtonStyles|mergeStyles|segmentedPillStyles)(?![\w$.])/g;

/**
 * Application token aliases retired with the legacy visual system. Bare
 * `text-muted` is the text role (now `text-muted-foreground`); `bg-muted`
 * is the preset surface and stays allowed. Retired color roles are checked
 * across color utility prefixes, not just the combinations seen at retirement.
 */
const RETIRED_COLOR_ROLES =
	"ink|subtle|paper|surface|surface-2|surface-3|input-bg|hover|active|primary-hover|line|line-strong|on-primary|on-danger|on-guest|backdrop-film|backdrop-blur";
const COLOR_UTILITY_PREFIXES =
	"bg|text|border(?:-[xytrblse])?|divide|ring|ring-offset|inset-ring|outline|fill|stroke|accent|caret|decoration|placeholder|shadow|inset-shadow|from|via|to";
const LEGACY_ALIAS_PATTERN = new RegExp(
	`(?<![\\w-])(?:(?:${COLOR_UTILITY_PREFIXES})-(?:${RETIRED_COLOR_ROLES})|text-muted|rounded-control|rounded-surface|shadow-overlay)(?![\\w-])`,
	"g",
);

/** CSS variables retired alongside the aliases above. */
const LEGACY_VAR_PATTERN = new RegExp(
	`var\\(--(?:${RETIRED_COLOR_ROLES})\\)`,
	"g",
);

/**
 * Preset-ring suppression. Primitives own their focus rings; callers must
 * not switch them off. Stock primitives (src/components/ui/) carry their
 * own justified resets, and native picker chrome keeps its exception.
 */
const RING_SUPPRESSION_PATTERN = /focus-visible:ring-0/g;

function isUiPrimitive(path: string): boolean {
	return path.startsWith("src/components/ui/");
}

function isGenuineChromeException(source: string): boolean {
	return source.includes("::picker") || source.includes("appearance");
}

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
		if (!isUiPrimitive(path)) {
			for (const match of source.matchAll(LEGACY_VAR_PATTERN)) {
				warn(
					match.index,
					"Retired application token. Use the preset token (foreground, muted-foreground, background, card, muted, accent, border, input, primary-foreground) or a genuine status token.",
				);
			}
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
	if (!isUiPrimitive(path)) {
		for (const match of source.matchAll(RETIRED_MODULE_PATTERN)) {
			warn(
				match.index,
				"Retired style module. Import the shadcn primitive from @/components/ui/ instead.",
			);
		}
		for (const match of source.matchAll(RETIRED_RECIPE_PATTERN)) {
			warn(
				match.index,
				"Retired style recipe. Use the shadcn primitive variants instead.",
			);
		}
		for (const match of source.matchAll(LEGACY_ALIAS_PATTERN)) {
			warn(
				match.index,
				"Retired application token. Use the preset token (text-foreground, text-muted-foreground, bg-background, bg-card, bg-muted, bg-accent, border-border, border-input, text-primary-foreground, rounded-md, rounded-xl) or a genuine status token.",
			);
		}
		for (const match of source.matchAll(LEGACY_VAR_PATTERN)) {
			warn(
				match.index,
				"Retired application token. Use the preset token (foreground, muted-foreground, background, card, muted, accent, border, input, primary-foreground) or a genuine status token.",
			);
		}
		if (!isGenuineChromeException(source)) {
			for (const match of source.matchAll(RING_SUPPRESSION_PATTERN)) {
				warn(
					match.index,
					"Preset-ring suppression. Primitives own their focus rings; do not switch them off in app scopes.",
				);
			}
		}
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
