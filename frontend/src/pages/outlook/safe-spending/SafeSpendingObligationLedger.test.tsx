import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	ObligationRows,
	SafeSpendingObligationLedger,
} from "./SafeSpendingObligationLedger.tsx";
import type {
	ObligationRow,
	ObligationSection,
} from "./safeSpendingDetailModel.ts";

const row = (id: string, amount: number | null): ObligationRow => ({
	id,
	name: `Obligation ${id}`,
	date: "2026-11-25",
	amount,
	detail: amount === null ? "Payment unverified" : null,
});

describe("safe spending obligation ledger", () => {
	it("keeps known details visible when one amount and the total are unknown", () => {
		const html = renderToStaticMarkup(
			<ObligationRows
				label="Bills"
				rows={[row("a", 40.25), row("b", null), row("c", 0)]}
			/>,
		);
		expect(html).toContain("$40.25");
		expect(html).toContain("$0.00");
		expect(html).toContain("Payment unverified");
		expect(html).toContain("Unavailable");
		expect(html).not.toContain("—");
	});

	it("shows Unavailable for an unknown section total", () => {
		const sections: ObligationSection[] = [
			{ title: "Bills", total: null, rows: [row("a", 40.25)] },
		];
		const html = renderToStaticMarkup(
			<SafeSpendingObligationLedger sections={sections} />,
		);
		expect(html).toContain("Unavailable");
		expect(html).toContain("$40.25");
		expect(html).not.toContain("—");
	});
});
