import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { testAccount } from "../../mocks/account.ts";
import { PositionEvidence } from "./PositionEvidence.tsx";

it("does not report a missing account balance as zero", () => {
	const html = renderToStaticMarkup(
		<PositionEvidence
			plan={{ ...testAccount, accounts: [testAccount.accounts[0]!] }}
			position={{
				asOfDate: testAccount.startDate,
				netWorth: 100,
				accounts: [],
			}}
			onClose={() => {}}
		/>,
	);
	expect(html).toContain("Unavailable");
	expect(html).not.toContain("$0");
});

it("reports a real zero balance as zero", () => {
	const html = renderToStaticMarkup(
		<PositionEvidence
			plan={{ ...testAccount, accounts: [testAccount.accounts[0]!] }}
			position={{
				asOfDate: testAccount.startDate,
				netWorth: 0,
				accounts: [{ accountId: testAccount.accounts[0]!.id, balance: 0 }],
			}}
			onClose={() => {}}
		/>,
	);
	expect(html).toContain("$0");
	expect(html).not.toContain("Unavailable");
});
