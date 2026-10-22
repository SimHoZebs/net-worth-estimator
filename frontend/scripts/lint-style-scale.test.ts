// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	normalizeSpacingClasses,
	normalizeSpacingUtility,
	normalizeStyleScale,
	styleScaleWarnings,
} from "./lint-style-scale.ts";

describe("standard Tailwind spacing", () => {
	it.each([
		["gap-[4px]", "gap-1"],
		["gap-[5px]", "gap-1"],
		["px-[1.25rem]", "px-5"],
		["h-[39px]", "h-10"],
		["w-[250px]", "w-63"],
		["size-[1px]", "size-px"],
		["min-h-[2px]", "min-h-0.5"],
		["mt-[3px]", "mt-1"],
		["p-[0px]", "p-0"],
		["m-[0]", "m-0"],
		["-mt-[5px]", "-mt-1"],
		["mt-[-5px]", "-mt-1"],
		["-left-[-12px]", "left-3"],
		["scroll-mt-[13px]", "scroll-mt-3"],
		["basis-[2rem]", "basis-8"],
		["indent-[9px]", "indent-2"],
		["space-x-[5px]", "space-x-1"],
		["border-spacing-[5px]", "border-spacing-1"],
		["sm:hover:-mt-[5px]!", "sm:hover:-mt-1!"],
		["focus:!px-[12px]", "focus:!px-3"],
		["[&>svg]:w-[15px]", "[&>svg]:w-4"],
		["[@media(max-width:600px)]:p-[5px]", "[@media(max-width:600px)]:p-1"],
		[
			"dark:data-[state=open]:p-[10px_13px]",
			"dark:data-[state=open]:py-3 dark:data-[state=open]:px-3",
		],
		["p-[4px_8px_12px]", "pt-1 px-2 pb-3"],
		[
			"hover:m-[4px_8px_12px_16px]",
			"hover:mt-1 hover:mr-2 hover:mb-3 hover:ml-4",
		],
		["inset-[4px_8px]", "inset-y-1 inset-x-2"],
		["inset-[4px_8px_12px_16px]", "top-1 right-2 bottom-3 left-4"],
		["gap-[10px_13px]", "gap-y-3 gap-x-3"],
	])("normalizes %s", (input, expected) => {
		expect(normalizeSpacingUtility(input)).toBe(expected);
	});

	it.each([
		"p-1",
		"h-px",
		"gap-0.5",
		"max-w-140",
		"text-[13px]",
		"font-[650]",
		"duration-[150ms]",
		"border-[1px]",
		"outline-offset-[3px]",
		"gap-(--runtime-gap)",
		"gap-[var(--gap)]",
		"w-[50%]",
		"min-h-[90dvh]",
		"min-h-[6lh]",
		"w-[calc(100%-20px)]",
		"max-w-[min(570px,100%)]",
		"w-[clamp(10px,50vw,800px)]",
		"p-[5px_var(--gutter)]",
		"grid-cols-[1fr_260px]",
		"[--offset:5px]",
		"px-[4px_8px]",
	])("preserves native classes and layout constraints: %s", (input) => {
		expect(normalizeSpacingUtility(input)).toBe(input);
	});

	it("preserves whitespace in class lists", () => {
		expect(normalizeSpacingClasses("flex  gap-[5px]\n px-[12px]")).toBe(
			"flex  gap-1\n px-3",
		);
	});

	it.each([
		["gap-1.5", "gap-2"],
		["sm:px-7!", "sm:px-8!"],
		["-mt-3.5", "-mt-4"],
		["p-10", "p-12"],
		["rounded", "rounded-control"],
		["rounded-md", "rounded-control"],
		["hover:rounded-lg", "hover:rounded-surface"],
		["rounded-t-xl", "rounded-t-surface"],
	])("consolidates %s", (input, expected) => {
		expect(normalizeSpacingUtility(input)).toBe(expected);
	});
});

describe("source check and fix", () => {
	it("checks class attributes, static maps and template branches, not semantic strings", () => {
		const source = `
const message = "gap-[5px]";
const tones = { active: "p-[5px]" };
const itemClasses = { wide: "w-[31px]" };
const element = <div title="p-[9px]" className={\`flex gap-[5px] \${enabled ? "px-[12px]" : tones.active} \${itemClasses.wide}\`} />;
`;
		const fixed = normalizeStyleScale("src/Card.tsx", source);
		expect(fixed).toContain('const message = "gap-[5px]"');
		expect(fixed).toContain('title="p-[9px]"');
		expect(fixed).toContain('active: "p-1"');
		expect(fixed).toContain('wide: "w-8"');
		expect(fixed).toContain("flex gap-1");
		expect(fixed).toContain('enabled ? "px-3"');
		expect(styleScaleWarnings("src/Card.tsx", source)).toHaveLength(4);
		expect(styleScaleWarnings("src/Card.tsx", source)[0]).toContain(
			"warning style-scale:",
		);
		expect(normalizeStyleScale("src/Card.tsx", fixed)).toBe(fixed);
	});

	it("does not change class conditions, object keys or comments", () => {
		const source = `// gap-[5px]
const names = { "p-[5px]": "semantic" };
const element = <div className={label === "p-[5px]" ? "p-[8px]" : "p-[12px]"} />;`;
		const fixed = normalizeStyleScale("src/Card.tsx", source);
		expect(fixed).toContain("// gap-[5px]");
		expect(fixed).toContain('"p-[5px]": "semantic"');
		expect(fixed).toContain('label === "p-[5px]" ? "p-2" : "p-3"');
		expect(styleScaleWarnings("src/Card.tsx", source)).toHaveLength(2);
	});

	it("supports TS className properties and class helpers", () => {
		const source = `const columns = [{ className: "px-[13px]" }];
const result = clsx("gap-[5px]", enabled && "mt-[8px]");`;
		expect(normalizeStyleScale("src/table.ts", source)).toContain(
			'className: "px-3"',
		);
		expect(normalizeStyleScale("src/table.ts", source)).toContain(
			'clsx("gap-1", enabled && "mt-2")',
		);
		expect(styleScaleWarnings("src/table.ts", source)[1]).toContain(
			"src/table.ts:2:",
		);
	});

	it("checks exported static recipes and mergeStyles arguments", () => {
		const source = `export const dialogBodyStyles = "p-7";
const element = mergeStyles("rounded-md", active && "gap-2.5");`;
		const fixed = normalizeStyleScale("src/recipes.ts", source);
		expect(fixed).toContain('dialogBodyStyles = "p-8"');
		expect(fixed).toContain(
			'mergeStyles("rounded-control", active && "gap-3")',
		);
		expect(styleScaleWarnings("src/recipes.ts", source)).toHaveLength(3);
		expect(styleScaleWarnings("src/recipes.ts", fixed)).toEqual([]);
	});

	it("preserves CVA variant selections while checking their class values", () => {
		const source = `const recipe = cva("p-7", {
  variants: { shape: { rounded: "rounded-lg", square: "rounded-none" } },
  defaultVariants: { shape: "rounded" },
  compoundVariants: [{ shape: "rounded", class: "gap-1.5" }],
});`;
		const fixed = normalizeStyleScale("src/recipe.ts", source);
		expect(fixed).toContain('rounded: "rounded-surface"');
		expect(fixed).toContain('defaultVariants: { shape: "rounded" }');
		expect(fixed).toContain('shape: "rounded", class: "gap-2"');
		expect(styleScaleWarnings("src/recipe.ts", fixed)).toEqual([]);
	});

	it.each([
		"max-[600px]:p-4",
		"[@media(max-width:800px)]:hidden",
		"@max-[36rem]/card:p-4",
		"rounded-[7px]",
		"tracking-[-1px]",
		"max-w-190",
		"w-[calc(100%-80px)]",
		"p-[calc(1rem+1px)]",
		"grid-cols-[repeat(auto-fill,minmax(250px,1fr))]",
	])("rejects an independent design choice: %s", (token) => {
		expect(
			styleScaleWarnings("src/Card.tsx", `<div className="${token}" />`),
		).not.toEqual([]);
	});

	it("allows intrinsic constraints, runtime dimensions, hairlines, geometry, and named breakpoints", () => {
		const source = `<div className="p-4 gap-px w-px rounded-[inherit] max-w-xl sm:max-lg:grid-cols-2 @max-xl/card:p-3 w-(--balance-width) w-[2ch] max-w-[52ch] grid-cols-[repeat(auto-fit,minmax(min(100%,var(--container-3xs)),1fr))] [@media(pointer:coarse)]:p-4"><svg viewBox="0 0 840 360"><rect width={32} rx={2} /></svg></div>`;
		expect(styleScaleWarnings("src/Card.tsx", source)).toEqual([]);
	});

	it("leaves semantic fields beside a className property unchanged", () => {
		const source = `const data = { message: "p-[5px]", "className": "px-[12px]" };
const element = <div className={data.className} />;`;
		const fixed = normalizeStyleScale("src/Card.tsx", source);
		expect(fixed).toContain('message: "p-[5px]"');
		expect(fixed).toContain('"className": "px-3"');
		expect(styleScaleWarnings("src/Card.tsx", source)).toHaveLength(1);
	});

	it("does not resolve a semantic binding through a shadowed parameter", () => {
		const source = `const value = "p-[5px]";
function Card({ value }: Props) { return <div className={value} />; }`;
		expect(normalizeStyleScale("src/Card.tsx", source)).toBe(source);
	});

	it.each([
		"src/Card.test.tsx",
		"src/Card.spec.tsx",
		"src/__tests__/Card.tsx",
		"src/tests/fixture.ts",
		"src/fixtures/sample.css",
		"src/types.d.ts",
	])("skips %s", (path) => {
		const source = '<div className="gap-[5px]" />';
		expect(styleScaleWarnings(path, source)).toEqual([]);
		expect(normalizeStyleScale(path, source)).toBe(source);
	});

	it("normalizes @apply and raw spacing declarations, not unrelated CSS dimensions", () => {
		const source = `/* padding: 5px; */
.card {
  @apply hover:p-[10px_13px] gap-[5px];
  padding: 10px 13px;
  margin-inline: -5px auto;
  min-width: 250px;
  height: 0px;
  gap: 1px 2px;
  font-size: 13px;
  border-width: 1px;
  --runtime-size: 13px;
}`;
		const fixed = normalizeStyleScale("src/card.css", source);
		expect(fixed).toContain("@apply hover:py-3 hover:px-3 gap-1;");
		expect(fixed).toContain("padding: --spacing(3) --spacing(3);");
		expect(fixed).toContain("margin-inline: --spacing(-1) auto;");
		expect(fixed).toContain("min-width: --spacing(63);");
		expect(fixed).toContain("height: 0;");
		expect(fixed).toContain("gap: --spacing(0.25) --spacing(0.5);");
		expect(fixed).toContain("font-size: 13px;");
		expect(fixed).toContain("border-width: 1px;");
		expect(fixed).toContain("/* padding: 5px; */");
		expect(fixed).toContain("--runtime-size: 13px;");
		expect(styleScaleWarnings("src/card.css", source)).toHaveLength(6);
		expect(styleScaleWarnings("src/card.css", source)[0]).toContain(
			"src/card.css:3:",
		);
		expect(styleScaleWarnings("src/card.css", fixed)).toEqual([]);
	});

	it("preserves CSS runtime calculations, percentages, viewport units and breakpoints", () => {
		const source = `@media (max-width: 600px) {
.card {
  width: min(570px, calc(100% - 32px));
  height: calc(var(--height, 42px) - 10px);
  max-height: 90dvh;
  min-height: 6lh;
  margin: 0 var(--gap) --spacing(3);
  padding: env(safe-area-inset-top, 5px);
  inset: 50%;
}}`;
		expect(normalizeStyleScale("src/card.css", source)).toBe(source);
		expect(styleScaleWarnings("src/card.css", source)).toEqual([]);
	});

	it("applies the finite scale to raw CSS and spacing functions", () => {
		const source = `.card { padding: --spacing(7); gap: 6px; margin: 10px; width: --spacing(7); }`;
		const fixed = normalizeStyleScale("src/card.css", source);
		expect(fixed).toContain("padding: --spacing(8)");
		expect(fixed).toContain("gap: --spacing(2)");
		expect(fixed).toContain("margin: --spacing(3)");
		expect(fixed).toContain("width: --spacing(7)");
		expect(styleScaleWarnings("src/card.css", fixed)).toEqual([]);
	});
});
