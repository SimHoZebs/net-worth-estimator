// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBaseDocument } from "@/lib/projection/__fixtures__";
import { makeAccount } from "@/lib/projection/__fixtures__/accounts";
import { makePosting } from "@/lib/projection/__fixtures__/postings";
import { useStore } from "@/store";
import { HouseholdCycleCard } from "./HouseholdCycleCard";
import { HouseholdCycleSettingsCard } from "./HouseholdCycleSettingsCard";

afterEach(cleanup);
beforeEach(() => {
	useStore.getState().resetHouseholdCycleInputs();
});

function syncDocument() {
	return createBaseDocument({
		accounts: [
			makeAccount({ id: "checking" }),
			makeAccount({ id: "prime_card", label: "Prime" }),
		],
		checkpoints: [
			{
				Date: "2026-08-03",
				AccountId: "checking",
				Balance: 1500,
				source: "simplefin",
			},
		],
		postings: [
			makePosting({
				id: "sfin-pending-prime_card-a",
				label: "Pending charge",
				sourceAccountId: "prime_card",
				destinations: null,
				arithmetic: "42.10",
				frequency: "once",
				startDate: "2026-08-02",
				enabled: false,
				source: "simplefin",
			}),
		],
	});
}

function renderResults(document: ReturnType<typeof createBaseDocument>) {
	return render(
		<MemoryRouter>
			<HouseholdCycleCard document={document} />
		</MemoryRouter>,
	);
}

describe("HouseholdCycleCard", () => {
	it("renders the four status lines at $0 defaults without inputs", () => {
		renderResults(createBaseDocument());

		expect(screen.getAllByText("Cash cushion").length).toBeGreaterThan(0);
		expect(
			screen.getAllByText("Current cycle committed through the 19th").length,
		).toBeGreaterThan(0);
		expect(screen.getAllByText("Theoretical room left").length).toBeGreaterThan(
			0,
		);
		expect(
			screen.getAllByText("Conservative room left").length,
		).toBeGreaterThan(0);
		expect(screen.getByText(/So the clean numbers are:/)).not.toBeNull();
		expect(screen.queryByLabelText("Checking balance")).toBeNull();
		expect(screen.getByRole("link", { name: "Edit inputs" })).toHaveProperty(
			"tagName",
			"A",
		);
	});

	it("reflects inputs edited in Settings on the results card", () => {
		const document = createBaseDocument();
		render(
			<MemoryRouter>
				<HouseholdCycleSettingsCard document={document} />
			</MemoryRouter>,
		);

		fireEvent.change(screen.getByLabelText("Checking balance"), {
			target: { value: "2000" },
		});
		fireEvent.change(
			screen.getByLabelText("Unpaid cash obligations before next paycheck"),
			{ target: { value: "500" } },
		);
		fireEvent.change(
			screen.getByLabelText("Prime current-cycle exposure (incl. pending)"),
			{ target: { value: "400" } },
		);
		fireEvent.change(screen.getByLabelText("Expected next paycheck"), {
			target: { value: "5000" },
		});
		fireEvent.change(screen.getByLabelText("Next month's fixed obligations"), {
			target: { value: "2500" },
		});
		cleanup();

		renderResults(document);

		// 2000 − 500 = 1500 cushion; 400 + 0 + 0 = 400 committed;
		// 5000 − 2500 − 400 = 2100 theoretical; 2100 − 725 = 1375 conservative.
		expect(screen.getByText(/\$1,500 cash cushion now,/)).not.toBeNull();
	});

	it("seeds card exposure and staleness from sync rows", () => {
		renderResults(syncDocument());

		expect(
			screen.getAllByText(
				(_, element) => element?.textContent?.includes("$42") ?? false,
			).length,
		).toBeGreaterThan(0);
		expect(screen.getByText(/Synced balances as of/)).not.toBeNull();
	});
});

describe("HouseholdCycleSettingsCard", () => {
	it("groups inputs by lane and keeps manual edits", () => {
		render(
			<MemoryRouter>
				<HouseholdCycleSettingsCard document={syncDocument()} />
			</MemoryRouter>,
		);

		expect(screen.getByText("Cash lane · current checking")).not.toBeNull();
		expect(
			screen.getByText("Card lane · paid from next paycheck"),
		).not.toBeNull();
		expect(
			screen.getByText("Paycheck lane · next cycle capacity"),
		).not.toBeNull();

		const prime = screen.getByLabelText(
			"Prime current-cycle exposure (incl. pending)",
		) as HTMLInputElement;
		expect(prime.value).toBe("42.1");
		fireEvent.change(prime, { target: { value: "100" } });
		expect(prime.value).toBe("100");
	});
});
