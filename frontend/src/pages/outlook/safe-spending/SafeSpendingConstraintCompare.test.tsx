import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SafeSpendingConstraintCompare } from "./SafeSpendingConstraintCompare.tsx";

const render = (prePaydayRoom: number | null, postIncomeRoom: number | null) =>
	renderToStaticMarkup(
		<SafeSpendingConstraintCompare
			prePaydayRoom={prePaydayRoom}
			postIncomeRoom={postIncomeRoom}
		/>,
	);

describe("cash check comparison", () => {
	it("shows both server room figures on one scale and names the binding check", () => {
		const html = render(200, 800);
		expect(html).toContain("Before payday");
		expect(html).toContain("After payday pay");
		expect(html).toContain("$200.00");
		expect(html).toContain("$800.00");
		expect(html).toContain("Before payday is the tighter check.");
		expect(html).toContain('aria-valuetext="$200.00"');
		expect(html).not.toContain("%</span>");
	});

	it("names the second check when it binds", () => {
		expect(render(600, 100)).toContain(
			"After payday pay is the tighter check.",
		);
	});

	it("renders nothing without both room figures", () => {
		expect(render(null, 100)).toBe("");
		expect(render(100, null)).toBe("");
	});
});
