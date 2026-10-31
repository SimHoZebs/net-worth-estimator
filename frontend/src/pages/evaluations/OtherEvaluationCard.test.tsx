import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dateLabel } from "@/domain/format.ts";
import type { OtherEvaluation } from "@/domain/result.ts";
import { financialModelFixture } from "@/mocks/financialModel.ts";
import { OtherEvaluationCard } from "@/pages/evaluations/OtherEvaluationCard.tsx";
import {
	useSavedAccounts,
	useSavedStartDate,
	useSavedTransactions,
} from "@/state/savedRows.ts";

vi.mock("@/state/savedRows.ts", () => ({
	useSavedAccounts: vi.fn(),
	useSavedTransactions: vi.fn(),
	useSavedStartDate: vi.fn(),
	useSavedEvaluations: vi.fn(),
}));

afterEach(cleanup);
beforeEach(() => {
	vi.mocked(useSavedAccounts).mockReturnValue(financialModelFixture.accounts);
	vi.mocked(useSavedTransactions).mockReturnValue(
		financialModelFixture.transactions,
	);
	vi.mocked(useSavedStartDate).mockReturnValue(financialModelFixture.startDate);
});

const financialIndependence: OtherEvaluation = {
	id: "fi",
	name: "Financial independence",
	type: "financialIndependence",
	enabled: true,
	status: "satisfied",
	goal: "$80,000/yr spending",
	outcomeDate: "2040-06-01",
	outcomeText: "Satisfied",
	qualifier: null,
	progress: null,
	postingIds: null,
};

const cycleBase: OtherEvaluation = {
	id: "cycle",
	name: "Monthly cycle",
	type: "cycleFulfillment",
	enabled: true,
	status: "satisfied",
	goal: null,
	outcomeDate: null,
	outcomeText: "Within budget",
	qualifier: null,
	progress: { fraction: 0.9, current: "$900", share: "90%" },
	postingIds: null,
};

function renderCard(item: OtherEvaluation) {
	return render(
		<OtherEvaluationCard
			item={item}
			projection={null}
			pin={{ pinned: false, onPinChange: () => {} }}
		/>,
	);
}

describe("OtherEvaluationCard", () => {
	it("renders financial independence with its goal, date, and badge", () => {
		const view = renderCard(financialIndependence);
		expect(
			view.getByRole("region", { name: financialIndependence.name }),
		).toBeTruthy();
		expect(view.getByText("$80,000/yr spending")).toBeTruthy();
		expect(view.getByText(dateLabel("2040-06-01"))).toBeTruthy();
		// The dated outcome shows the date, so "Satisfied" is the badge alone.
		expect(view.getByText("Satisfied")).toBeTruthy();
		expect(
			view.getByRole("button", {
				name: `Pin ${financialIndependence.name} to Outlook`,
			}),
		).toBeTruthy();
	});

	it.each([
		{ status: "satisfied", text: "Within budget" },
		{ status: "not-satisfied", text: "Over budget" },
	] as const)(
		"renders cycle fulfillment with the $text badge and no goal line",
		({ status, text }) => {
			const view = renderCard({
				...cycleBase,
				status,
				outcomeText: text,
				// Cycle outcomes never carry a goal; the card must not render one.
				goal: "$80,000/yr spending",
			});
			expect(view.getByRole("region", { name: cycleBase.name })).toBeTruthy();
			// Outcome value and status badge share the wording.
			expect(view.getAllByText(text)).toHaveLength(2);
			expect(view.queryByText("$80,000/yr spending")).toBeNull();
		},
	);

	it("keeps paused evaluations explicit", () => {
		const view = renderCard({ ...cycleBase, enabled: false });
		expect(view.getByText("Paused")).toBeTruthy();
		expect(view.getByText("Excluded from evaluation")).toBeTruthy();
	});

	it("renders numeric values and bands alongside the status badge", () => {
		const view = renderCard({
			...cycleBase,
			value: { current: 900, unit: "currency" },
			bands: { p10: 800, p50: 900, p90: 950 },
		});
		expect(view.getAllByText("Within budget")).toHaveLength(2);
		expect(view.getAllByText("$900")).toHaveLength(2);
		expect(view.getByText(/Bands p10 800/)).toBeTruthy();
	});

	it("renders no value line without a numeric result", () => {
		const view = renderCard(cycleBase);
		expect(view.queryByText(/Value:/)).toBeNull();
		expect(view.queryByText(/Bands/)).toBeNull();
	});
});
