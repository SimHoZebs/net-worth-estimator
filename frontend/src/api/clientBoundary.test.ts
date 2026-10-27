import ts from "typescript";
import { expect, expectTypeOf, it } from "vitest";
import { logout, projectStochastic } from "./generated/endpoints.ts";

it("preserves Response return types for generated logout and streaming endpoints", () => {
	expectTypeOf(logout).returns.toEqualTypeOf<Promise<Response>>();
	expectTypeOf(projectStochastic).returns.toEqualTypeOf<Promise<Response>>();
});

function networkReferences(source: string): string[] {
	const file = ts.createSourceFile(
		"source.tsx",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);
	const found: string[] = [];
	const visit = (node: ts.Node) => {
		if (
			ts.isIdentifier(node) &&
			["fetch", "XMLHttpRequest", "EventSource", "WebSocket"].includes(
				node.text,
			)
		)
			found.push(node.text);
		ts.forEachChild(node, visit);
	};
	visit(file);
	return found;
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
