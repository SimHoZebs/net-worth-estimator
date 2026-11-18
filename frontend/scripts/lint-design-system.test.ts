import { describe, expect, it } from "vitest";
import { designSystemWarnings } from "./lint-design-system.ts";

describe("focused design-system checks", () => {
	it("rejects private class selector contracts", () => {
		for (const selector of [
			"[&_.modal-header]:p-0",
			"[.table-actions_&]:w-7",
			"[&.active]:bg-card",
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
				'<div className="grid gap-1 grid-cols-[1fr_auto] w-[calc(100%-.5rem)] [&>svg]:size-4 data-[open=true]:block aria-selected:text-primary group-aria-[pressed=false]:text-muted-foreground [body:has([data-draft-bar])_&]:bottom-28 [&[data-file=example.csv]]:block" />',
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
				'const colors = { active: "hover:bg-primary text-primary-foreground" };',
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
	it("keeps canonical preset tokens and genuine status tokens flexible", () => {
		expect(
			designSystemWarnings(
				"src/components/Card.tsx",
				'<div className="bg-background text-foreground bg-card text-card-foreground bg-muted text-muted-foreground bg-accent text-accent-foreground border-border border-input rounded-md rounded-xl text-primary-foreground bg-success-bg text-danger-text border-warning-border bg-guest text-guest-foreground border-card divide-border ring-card" />',
			),
		).toEqual([]);
	});
	it("rejects preset-ring suppression in app scopes", () => {
		expect(
			designSystemWarnings(
				"src/components/Card.tsx",
				'<button className="focus-visible:outline-solid focus-visible:ring-0" />',
			),
		).toHaveLength(1);
		expect(
			designSystemWarnings(
				"src/components/ui/input-group.tsx",
				'<input className="ring-0 focus-visible:ring-0" />',
			),
		).toEqual([]);
		expect(
			designSystemWarnings(
				"src/components/Picker.tsx",
				'<select className="[&::picker(select)]:rounded-md focus-visible:ring-0" />',
			),
		).toEqual([]);
	});
});
