import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import {
	transactionFixture,
	projectionFixture,
} from "../../mocks/projection.ts";
import { SafeSpendingEvidence } from "./SafeSpendingEvidence.tsx";

// This test covers evidence content rather than the native modal lifecycle.
vi.mock("../Modal.tsx", async (importOriginal) => ({
	...(await importOriginal<typeof import("../Modal.tsx")>()),
	Modal: ({ children }: { children: ReactNode }) => (
		<section>{children}</section>
	),
}));

afterEach(cleanup);

describe("SafeSpendingEvidence", () => {
	it("retains table headings, shortfall evidence, and date sorting", () => {
		const projection = projectionFixture({
			transactions: [
				transactionFixture({
					transactionId: "living",
					name: "Earlier bill",
					date: "2026-10-01",
				}),
				transactionFixture({
					transactionId: "mortgage-payment",
					name: "Later bill",
					date: "2026-10-05",
					constraint: null,
				}),
			],
		});
		const view = render(
			<SafeSpendingEvidence
				startDate={financialModelFixture.startDate}
				projection={projection}
				onClose={() => {}}
			/>,
		);
		const table = within(
			view.getByRole("table", {
				name: "Scheduled transactions for the next 30 days.",
			}),
		);
		expect(
			table.getAllByRole("columnheader").map((header) => header.textContent),
		).toEqual(["Date", "Transaction", "Requested", "Funded"]);
		expect(
			table.getAllByRole("rowheader").map((header) => header.textContent),
		).toEqual(["Later bill", "Earlier bill"]);
		expect(table.getByText("Shortfall")).toBeTruthy();
		fireEvent.click(
			view.getByRole("button", { name: /Sort transactions: Newest first/ }),
		);
		expect(
			table.getAllByRole("rowheader").map((header) => header.textContent),
		).toEqual(["Earlier bill", "Later bill"]);
		expect(
			view.getByText(
				/Cash above protected balances is not a safe-to-spend recommendation/,
			),
		).toBeTruthy();
	});

	it("retains the empty-period explanation", () => {
		const view = render(
			<SafeSpendingEvidence
				startDate={financialModelFixture.startDate}
				projection={projectionFixture()}
				onClose={() => {}}
			/>,
		);
		expect(
			view.getByText("No transactions scheduled in this period."),
		).toBeTruthy();
	});
});
