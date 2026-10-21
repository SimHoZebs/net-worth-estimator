// @vitest-environment node
import { describe, expect, it } from "vitest";
import { typographyWarnings } from "./lint-typography.ts";

describe("typography ownership warnings", () => {
	it.each([
		".card { font-family: serif; }",
		"@layer components { .card { font-family: var(--font-display); } }",
		".card { font: 400 1rem serif; }",
		".card { --font-ui: serif; }",
	])("warns about a component override: %s", (source) => {
		expect(typographyWarnings("src/components/card.css", source)).toHaveLength(
			1,
		);
	});

	it.each([
		["src/components/card.css", ".card { font: inherit; font-size: 2rem; }"],
		["src/styles/typography.css", ".new-role { font-family: AnyFutureFont; }"],
		["src/styles/typography.css", ".new-role { font: 1rem AnyFutureFont; }"],
		["src/styles/tokens.css", ":root { --font-new-role: AnyFutureFont; }"],
	])("allows shared choices and inherited styles in %s", (path, source) => {
		expect(typographyWarnings(path, source)).toEqual([]);
	});

	it.each([
		'<div style={{ fontFamily: "serif" }} />',
		'const style = { ["fontFamily"]: "serif" };',
		'<div style={{ font: "1rem serif" }} />',
		'<svg><text fontFamily="serif">Label</text></svg>',
		'<svg><text font-family="serif">Label</text></svg>',
		'<div style={{ "--font-ui": "serif" }} />',
		'element.style.fontFamily = "serif";',
		'element.style["font"] = "1rem serif";',
		'element.style.setProperty("--font-ui", "serif");',
	])("warns about inline family selection: %s", (source) => {
		expect(typographyWarnings("src/components/Card.tsx", source)).toHaveLength(
			1,
		);
	});

	it("reports the source line without treating comments as declarations", () => {
		const warnings = typographyWarnings(
			"src/components/card.css",
			"/* font-family: serif; */\n.card { font-family: serif; }",
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("card.css:2: warning typography-owner:");
	});
});
