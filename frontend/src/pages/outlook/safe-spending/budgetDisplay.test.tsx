import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { amountText } from "./amountText.ts";
import { BudgetAmount, BudgetMetric } from "./budgetDisplay.tsx";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

describe("safe spending amount text", () => {
	it("uses Unavailable for a missing amount and never a dash", () => {
		expect(amountText(null)).toBe("Unavailable");
		expect(amountText(undefined)).toBe("Unavailable");
		expect(amountText(null, labels.cashUnverified)).toBe("Cash unverified");
		expect(amountText(null)).not.toContain("—");
	});

	it("renders a proven zero as $0.00", () => {
		expect(amountText(0)).toBe("$0.00");
		expect(amountText(-0)).toBe("$0.00");
	});
});

describe("safe spending budget amount", () => {
	const render = (props: Parameters<typeof BudgetAmount>[0]): string =>
		renderToStaticMarkup(<BudgetAmount {...props} />);

	it("shows the row status when the amount is unknown", () => {
		expect(render({ value: null })).toContain("Unavailable");
		expect(
			render({ value: null, missingText: labels.paycheckUnknown }),
		).toContain("Paycheck unknown");
		expect(render({ value: null })).not.toContain("—");
	});

	it("renders zero without a sign or a status", () => {
		const html = render({
			value: 0,
			describeShortfall: (a) => `Short by ${a}`,
		});
		expect(html).toContain("$0.00");
		expect(html).not.toContain("Short by");
		expect(html).not.toContain("Unavailable");
	});

	it("labels a negative estimate with a positive magnitude", () => {
		const html = render({
			value: -42.5,
			describeShortfall: (a) => `Over by ${a}`,
		});
		expect(html).toContain("Over by $42.50");
		expect(html).not.toContain("−$");
	});

	it("keeps the negative label separate from the surplus sign", () => {
		const negative = render({
			value: -42.5,
			showPlus: true,
			describeShortfall: (a) => `Over by ${a}`,
		});
		const positive = render({
			value: 42.5,
			showPlus: true,
			describeShortfall: (a) => `Over by ${a}`,
		});
		const plain = render({ value: 42.5 });
		expect(negative).toContain("Over by $42.50");
		expect(positive).toContain("+$42.50");
		expect(plain).toContain("$42.50");
		expect(plain).not.toContain("+$42.50");
	});

	it("forwards the missing status through BudgetMetric", () => {
		const html = renderToStaticMarkup(
			<BudgetMetric
				label="Expected pay"
				value={null}
				missingText="Paycheck unknown"
			/>,
		);
		expect(html).toContain("Paycheck unknown");
		expect(html).not.toContain("—");
		expect(html).not.toContain("Unavailable");
	});
});
