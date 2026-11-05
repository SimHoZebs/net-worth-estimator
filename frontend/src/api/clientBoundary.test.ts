import { expect, expectTypeOf, it } from "vitest";
import { logout, projectStochastic } from "./generated/endpoints.ts";

const networkNames = new Set([
	"fetch",
	"XMLHttpRequest",
	"EventSource",
	"WebSocket",
]);

// Keywords after which an expression (possibly a regex literal) follows, so
// a slash cannot be division.
const nonEndingKeywords = new Set([
	"await",
	"case",
	"delete",
	"do",
	"else",
	"in",
	"instanceof",
	"new",
	"of",
	"return",
	"throw",
	"typeof",
	"void",
	"yield",
]);

// Keywords whose parenthesized group is a condition, not call arguments: a
// slash after the closing paren starts a regex, not a division.
const controlKeywords = new Set([
	"catch",
	"for",
	"if",
	"switch",
	"while",
	"with",
]);

it("preserves Response return types for generated logout and streaming endpoints", () => {
	expectTypeOf(logout).returns.toEqualTypeOf<Promise<Response>>();
	expectTypeOf(projectStochastic).returns.toEqualTypeOf<Promise<Response>>();
});

// A token scan instead of a TypeScript parse: identifiers in code count, and
// comments, strings, and template text do not. Interpolations scan as code,
// and a slash starts a regex unless the previous token can end an expression.
function networkReferences(source: string): string[] {
	const found: string[] = [];
	const state = { index: 0 };
	scanCode(source, state, null, found);
	return found;
}

function isIdentifierStart(char: string): boolean {
	return (
		(char >= "a" && char <= "z") ||
		(char >= "A" && char <= "Z") ||
		char === "_" ||
		char === "$"
	);
}

function isIdentifierPart(char: string): boolean {
	return isIdentifierStart(char) || (char >= "0" && char <= "9");
}

function isDigit(char: string): boolean {
	return char >= "0" && char <= "9";
}

function isWhitespace(char: string): boolean {
	return (
		char === " " ||
		char === "\t" ||
		char === "\n" ||
		char === "\r" ||
		char === "\v" ||
		char === "\f"
	);
}

function skipLineComment(source: string, state: { index: number }): void {
	while (state.index < source.length && source[state.index] !== "\n")
		state.index++;
}

function skipBlockComment(source: string, state: { index: number }): void {
	state.index += 2;
	while (state.index < source.length) {
		if (source[state.index] === "*" && source[state.index + 1] === "/") {
			state.index += 2;
			return;
		}
		state.index++;
	}
}

function skipString(
	source: string,
	state: { index: number },
	quote: string,
): void {
	state.index++;
	while (state.index < source.length) {
		const char = source[state.index]!;
		if (char === "\\") {
			state.index += 2;
			continue;
		}
		state.index++;
		if (char === quote) return;
	}
}

function skipRegex(source: string, state: { index: number }): void {
	state.index++;
	let inClass = false;
	while (state.index < source.length) {
		const char = source[state.index]!;
		if (char === "\\") {
			state.index += 2;
			continue;
		}
		if (char === "[") inClass = true;
		else if (char === "]") inClass = false;
		else if (char === "/" && !inClass) {
			state.index++;
			return;
		} else if (char === "\n") return;
		state.index++;
	}
}

function scanTemplate(
	source: string,
	state: { index: number },
	found: string[],
): void {
	state.index++;
	while (state.index < source.length) {
		const char = source[state.index]!;
		if (char === "\\") {
			state.index += 2;
			continue;
		}
		if (char === "`") {
			state.index++;
			return;
		}
		if (char === "$" && source[state.index + 1] === "{") {
			state.index += 2;
			scanCode(source, state, "}", found);
			continue;
		}
		state.index++;
	}
}

// Scan code until the terminator at brace depth zero (or end of input when
// the terminator is null), collecting network-global identifiers.
function scanCode(
	source: string,
	state: { index: number },
	terminator: string | null,
	found: string[],
): void {
	let depth = 0;
	const controlParens: boolean[] = [];
	// A slash starts a regex unless the previous token can end an expression.
	let expressionEnd = false;
	let prevWord = "";
	while (state.index < source.length) {
		const char = source[state.index]!;
		if (terminator !== null && char === terminator && depth === 0) {
			state.index++;
			return;
		}
		if (char === "{" || char === "[") {
			depth++;
			expressionEnd = false;
			prevWord = "";
			state.index++;
			continue;
		}
		if (char === "(") {
			controlParens.push(controlKeywords.has(prevWord));
			prevWord = "";
			depth++;
			expressionEnd = false;
			state.index++;
			continue;
		}
		if (char === "}" || char === ")" || char === "]") {
			if (depth > 0) depth--;
			expressionEnd =
				char === ")" ? controlParens.pop() !== true : char !== "}";
			prevWord = "";
			state.index++;
			continue;
		}
		if (isWhitespace(char)) {
			state.index++;
			continue;
		}
		if (char === ";" || char === ",") {
			expressionEnd = false;
			prevWord = "";
			state.index++;
			continue;
		}
		if (char === "/" && source[state.index + 1] === "/") {
			skipLineComment(source, state);
			continue;
		}
		if (char === "/" && source[state.index + 1] === "*") {
			skipBlockComment(source, state);
			continue;
		}
		if (char === "'" || char === '"') {
			skipString(source, state, char);
			expressionEnd = true;
			prevWord = "";
			continue;
		}
		if (char === "`") {
			scanTemplate(source, state, found);
			expressionEnd = true;
			prevWord = "";
			continue;
		}
		if (char === "#") {
			// Private identifiers never match the globals below.
			state.index++;
			while (
				state.index < source.length &&
				isIdentifierPart(source[state.index]!)
			)
				state.index++;
			expressionEnd = true;
			prevWord = "";
			continue;
		}
		if (isIdentifierStart(char)) {
			let word = "";
			while (
				state.index < source.length &&
				isIdentifierPart(source[state.index]!)
			) {
				word += source[state.index];
				state.index++;
			}
			if (networkNames.has(word)) found.push(word);
			expressionEnd = !nonEndingKeywords.has(word);
			prevWord = word;
			continue;
		}
		if (
			isDigit(char) ||
			(char === "." && isDigit(source[state.index + 1] ?? ""))
		) {
			while (
				state.index < source.length &&
				(isIdentifierPart(source[state.index]!) || source[state.index] === ".")
			)
				state.index++;
			expressionEnd = true;
			prevWord = "";
			continue;
		}
		if (
			(char === "+" && source[state.index + 1] === "+") ||
			(char === "-" && source[state.index + 1] === "-")
		) {
			// Postfix update continues the expression; a prefix one takes an
			// operand, but no valid code puts a regex there anyway.
			expressionEnd = true;
			prevWord = "";
			state.index += 2;
			continue;
		}
		if (char === "/") {
			if (expressionEnd) {
				expressionEnd = false;
				prevWord = "";
				state.index++;
			} else {
				skipRegex(source, state);
				expressionEnd = true;
				prevWord = "";
			}
			continue;
		}
		expressionEnd = false;
		prevWord = "";
		state.index++;
	}
}

it("keeps application network transport inside the Orval mutator", () => {
	const sources = import.meta.glob<string>("../**/*.{ts,tsx}", {
		query: "?raw",
		import: "default",
		eager: true,
	});
	const violations: string[] = [];
	for (const [path, source] of Object.entries(sources)) {
		if (
			/\/(generated|mocks)\//.test(path) ||
			/\.(test|spec)\.tsx?$/.test(path) ||
			["../api/waypoint-fetch.ts", "./waypoint-fetch.ts"].includes(path)
		)
			continue;
		for (const reference of networkReferences(source))
			violations.push(`${path}: ${reference}`);
	}
	expect(violations).toEqual([]);
});

it("detects direct calls and transport aliases without matching comments or strings", () => {
	expect(
		networkReferences(
			`fetch('/v1'); window.fetch('/v1'); const send = globalThis.fetch.bind(globalThis); new EventSource('/v1');`,
		),
	).toEqual(["fetch", "fetch", "fetch", "EventSource"]);
	expect(
		networkReferences(`// fetch('/v1')\nconst message = "fetch failed";`),
	).toEqual([]);
});

it("scans template interpolations but not template text", () => {
	expect(networkReferences("`fetch ${fetch('/v1')}`")).toEqual(["fetch"]);
	expect(networkReferences("`fetch the report`")).toEqual([]);
});

it("tells division from regular expressions", () => {
	expect(networkReferences("const ratio = total / count;")).toEqual([]);
	expect(networkReferences("const ratio = total / fetch;")).toEqual(["fetch"]);
	expect(networkReferences("const hit = /fetch/.test(path);")).toEqual([]);
	expect(networkReferences("return /fetch/.test(path);")).toEqual([]);
	expect(networkReferences("if (ready) /fetch/.test(path);")).toEqual([]);
});

it("ignores private identifiers", () => {
	expect(networkReferences("class Store { #fetch = 1; }")).toEqual([]);
});

it("notes JSX text may over-trigger and stays fail-closed", () => {
	// JsxText is never an identifier, but telling copy from code needs a
	// parser. A bare transport name in copy warns; reword the copy.
	expect(networkReferences("<p>fetch the report</p>")).toEqual(["fetch"]);
});
