import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { testPlan } from "../../mocks/plan.ts";
import { PositionEvidence } from "./PositionEvidence.tsx";

it("does not report a missing account balance as zero", () => {
	const html = renderToStaticMarkup(
		<PositionEvidence
			plan={{ ...testPlan, accounts: [testPlan.accounts[0]!] }}
			position={{ asOfDate: testPlan.startDate, netWorth: 100, accounts: [] }}
			onClose={() => {}}
		/>,
	);
	expect(html).toContain("Unavailable");
	expect(html).not.toContain("$0");
});

it("reports a real zero balance as zero", () => {
	const html = renderToStaticMarkup(
		<PositionEvidence
			plan={{ ...testPlan, accounts: [testPlan.accounts[0]!] }}
			position={{
				asOfDate: testPlan.startDate,
				netWorth: 0,
				accounts: [{ accountId: testPlan.accounts[0]!.id, balance: 0 }],
			}}
			onClose={() => {}}
		/>,
	);
	expect(html).toContain("$0");
	expect(html).not.toContain("Unavailable");
});
