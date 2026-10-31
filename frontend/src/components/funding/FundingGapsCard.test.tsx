import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OtherEvaluation, Projection } from "@/domain/result.ts";
import { financialModelFixture } from "@/mocks/financialModel.ts";
import { projectionFixture, transactionFixture } from "@/mocks/projection.ts";
import { FundingGapsCard } from "./FundingGapsCard.tsx";

// Inspector assertions use a marker modal; the real modal keeps browser
// coverage.
vi.mock("./FundingGapsModal.tsx", () => ({
	FundingGapsModal: ({
		selectedId,
		onClose,
	}: {
		selectedId: string;
		onClose: () => void;
	}) => (
		<section role="dialog" aria-label="Funding gap inspector">
			<p data-testid="funding-selection">{selectedId}</p>
			<button type="button" onClick={onClose}>
				Close inspector
			</button>
		</section>
	),
}));

afterEach(cleanup);

const item: OtherEvaluation = {
	id: "funding",
	name: "Funding gaps",
	type: "postingFulfillment",
	enabled: true,
	status: "not-satisfied",
	goal: null,
	outcomeDate: null,
	outcomeText: "Unfunded",
	qualifier: null,
	progress: null,
	postingIds: null,
};

function cardProps(
	overrides: {
		item?: OtherEvaluation;
		projection?: Projection | null;
	} = {},
) {
	return {
		item: overrides.item ?? item,
		accounts: financialModelFixture.accounts,
		transactions: financialModelFixture.transactions,
		startDate: financialModelFixture.startDate,
		projection:
			overrides.projection ??
			projectionFixture({
				transactions: [transactionFixture()],
			}),
	};
}

describe("FundingGapsCard", () => {
	it("keeps the inspector open across data refreshes and closes it when its gap scope empties", () => {
		const view = render(<FundingGapsCard {...cardProps()} />);
		fireEvent.click(view.getByRole("button", { name: /Inspect cash flow/ }));
		expect(view.getByTestId("funding-selection").textContent).toBe(
			"renovation-2026-03-06",
		);
		// An unrelated refresh arrives with brand-new identities but the same
		// gaps: the open inspector stays on its gap.
		const refresh = projectionFixture({
			transactions: [transactionFixture()],
		});
		view.rerender(
			<FundingGapsCard
				{...cardProps()}
				accounts={[...financialModelFixture.accounts]}
				transactions={[...financialModelFixture.transactions]}
				projection={refresh}
			/>,
		);
		expect(view.getByTestId("funding-selection").textContent).toBe(
			"renovation-2026-03-06",
		);
		// The gap scope itself empties: the inspector closes instead of
		// showing a stale gap.
		view.rerender(
			<FundingGapsCard
				{...cardProps()}
				projection={refresh}
				item={{ ...item, postingIds: [] }}
			/>,
		);
		expect(view.queryByTestId("funding-selection")).toBeNull();
	});

	it("closes the inspector when its gap leaves the scope while other gaps remain", () => {
		const projection = projectionFixture({
			transactions: [
				transactionFixture(),
				transactionFixture({
					transactionId: "other",
					name: "Other spend",
					date: "2026-04-01",
				}),
			],
		});
		const view = render(<FundingGapsCard {...cardProps({ projection })} />);
		fireEvent.click(view.getByRole("button", { name: /Inspect cash flow/ }));
		// Gaps order by date: the March renovation gap is inspected first.
		expect(view.getByTestId("funding-selection").textContent).toBe(
			"renovation-2026-03-06",
		);
		// Narrowing the scope removes the inspected gap while the April gap
		// remains: the inspector closes instead of falling back to it.
		view.rerender(
			<FundingGapsCard
				{...cardProps({ projection })}
				item={{ ...item, postingIds: ["other"] }}
			/>,
		);
		expect(view.queryByTestId("funding-selection")).toBeNull();
	});

	it("closes the inspector explicitly", () => {
		const view = render(<FundingGapsCard {...cardProps()} />);
		fireEvent.click(view.getByRole("button", { name: /Inspect cash flow/ }));
		expect(view.getByTestId("funding-selection")).toBeTruthy();
		fireEvent.click(view.getByRole("button", { name: "Close inspector" }));
		expect(view.queryByTestId("funding-selection")).toBeNull();
	});
});
