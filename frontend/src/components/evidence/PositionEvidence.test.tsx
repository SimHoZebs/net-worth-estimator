import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import { PositionEvidence } from "./PositionEvidence.tsx";

it("does not report a missing account balance as zero", () => {
	render(
		<PositionEvidence
			accounts={[financialModelFixture.accounts[0]!]}
			position={{
				asOfDate: financialModelFixture.startDate,
				netWorth: 100,
				accounts: [],
			}}
			onClose={() => {}}
		/>,
	);
	expect(screen.getByText("Unavailable")).toBeTruthy();
	expect(screen.queryByText(/\$0/)).toBeNull();
});

it("reports a real zero balance as zero", () => {
	render(
		<PositionEvidence
			accounts={[financialModelFixture.accounts[0]!]}
			position={{
				asOfDate: financialModelFixture.startDate,
				netWorth: 0,
				accounts: [
					{ accountId: financialModelFixture.accounts[0]!.id, balance: 0 },
				],
			}}
			onClose={() => {}}
		/>,
	);
	expect(screen.getAllByText(/\$0/)).toHaveLength(2);
	expect(screen.queryByText("Unavailable")).toBeNull();
});
