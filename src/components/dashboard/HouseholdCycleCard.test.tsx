// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createBaseDocument } from "@/lib/projection/__fixtures__";
import { HouseholdCycleCard } from "./HouseholdCycleCard";

afterEach(cleanup);

describe("HouseholdCycleCard", () => {
	it("renders the four status lines at $0 defaults", () => {
		render(<HouseholdCycleCard document={createBaseDocument()} />);

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
	});

	it("recomputes the clean numbers from entered values", () => {
		render(<HouseholdCycleCard document={createBaseDocument()} />);

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

		// 2000 − 500 = 1500 cushion; 400 + 0 + 0 = 400 committed;
		// 5000 − 2500 − 400 = 2100 theoretical; 2100 − 725 = 1375 conservative.
		expect(screen.getByText(/\$1,500 cash cushion now,/)).not.toBeNull();
	});
});
