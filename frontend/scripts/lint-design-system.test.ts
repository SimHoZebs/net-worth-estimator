import { describe, expect, it } from "vitest";
import { designSystemWarnings } from "./lint-design-system.ts";

describe("focused design-system checks", () => {
	it("rejects private class selector contracts", () => {
		for (const selector of [
			"[&_.modal-header]:p-0",
			"[.table-actions_&]:w-7",
			"[&.active]:bg-surface",
		]) {
			expect(
				designSystemWarnings(
					"src/Example.tsx",
					`<div className="${selector}" />`,
				),
			).toHaveLength(1);
		}
	});
	it("keeps layout, geometry, native states, and explicit data slots flexible", () => {
		expect(
			designSystemWarnings(
				"src/Example.tsx",
				'<div className="grid gap-1 grid-cols-[1fr_auto] w-[calc(100%-.5rem)] [&>svg]:size-4 data-[open=true]:block aria-selected:text-primary [body:has([data-draft-bar])_&]:bottom-28 [&[data-file=example.csv]]:block" />',
			),
		).toEqual([]);
	});
	it("requires semantic color roles outside the token owner", () => {
		expect(
			designSystemWarnings(
				"src/styles/tokens.css",
				"@theme { --color-primary: var(--color-emerald-700); }",
			),
		).toEqual([]);
		expect(
			designSystemWarnings(
				"src/example.ts",
				'const colors = { active: "hover:bg-emerald-700" };',
			),
		).toHaveLength(1);
		expect(
			designSystemWarnings(
				"src/example.ts",
				'const colors = { active: "hover:bg-primary text-on-primary" };',
			),
		).toEqual([]);
	});
	it("permits global base styles and custom chart texture CSS", () => {
		expect(
			designSystemWarnings(
				"src/styles/typography.css",
				"body { @apply text-sm; }",
			),
		).toEqual([]);
		expect(
			designSystemWarnings(
				"src/components/chart.css",
				'[data-pattern="dots"] { background-image: radial-gradient(currentColor 1px, transparent 1px); }',
			),
		).toEqual([]);
		expect(
			designSystemWarnings(
				"src/components/ui.css",
				".button { @apply rounded-md; }",
			),
		).toHaveLength(1);
	});
	it("ignores test fixtures", () => {
		expect(
			designSystemWarnings(
				"src/example.test.tsx",
				'<div className="bg-red-500 [&_.button]:p-0" />',
			),
		).toEqual([]);
	});
});
