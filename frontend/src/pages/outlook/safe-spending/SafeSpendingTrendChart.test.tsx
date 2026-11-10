import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AccountTransaction } from "../../../domain/accountActivity.ts";
import { safeSpendingTrend } from "../../../domain/safeSpendingTrend.ts";
import { SafeSpendingTrendChart } from "./SafeSpendingTrendChart.tsx";

function charge(date: string, amount: number): AccountTransaction {
	return {
		id: `charge-${date}-${amount}`,
		transactionId: `charge-${date}-${amount}`,
		date,
		name: "Card purchase",
		source: "historical",
		direction: "out",
		flow: "expense",
		counterparty: "External spending",
		from: "Household card",
		to: "External spending",
		amount,
		requested: amount,
		shortfall: 0,
		constraint: null,
		excluded: false,
		pending: false,
		void: false,
	};
}

describe("SafeSpendingTrendChart", () => {
	it("shows the average-rate projection and the projected limit date", () => {
		const trend = safeSpendingTrend({
			transactions: [charge("2026-01-21", 100)],
			cycleStart: "2026-01-20",
			cycleEnd: "2026-02-19",
			todayIso: "2026-01-21",
			limit: 400,
			safetyNet: 300,
		});
		render(<SafeSpendingTrendChart trend={trend} />);
		expect(
			screen.getByRole("heading", { name: "Card spending pace" }),
		).toBeTruthy();
		expect(screen.getByText("Limit ~ Jan 28 · $50 a day")).toBeTruthy();
		expect(screen.getByText("Spending so far")).toBeTruthy();
		expect(screen.getByText("Projected at average rate")).toBeTruthy();
		expect(screen.getByText("Protected reserve starts $300")).toBeTruthy();
		expect(screen.getByText("Card spending limit $400")).toBeTruthy();
		const chart = screen.getByRole("img", { name: "Card spending pace" });
		expect(chart.querySelector("desc")?.textContent).toContain(
			"limit is reached around Jan 28, 2026",
		);
	});

	it("labels a limit crossing that already happened", () => {
		const trend = safeSpendingTrend({
			transactions: [charge("2026-01-21", 100), charge("2026-01-22", 400)],
			cycleStart: "2026-01-20",
			cycleEnd: "2026-02-19",
			todayIso: "2026-01-22",
			limit: 400,
			safetyNet: 300,
		});
		render(<SafeSpendingTrendChart trend={trend} />);
		expect(screen.getByText("Over limit · $167 a day")).toBeTruthy();
		expect(
			screen
				.getByRole("img", { name: "Card spending pace" })
				.querySelector("desc")?.textContent,
		).toContain("limit was crossed on Jan 22, 2026");
	});

	it("labels a closed statement's thresholds as a historical budget", () => {
		const trend = safeSpendingTrend({
			transactions: [charge("2026-01-21", 100), charge("2026-01-22", 400)],
			cycleStart: "2026-01-20",
			cycleEnd: "2026-02-19",
			todayIso: "2026-02-19",
			limit: 400,
			safetyNet: 300,
		});
		render(<SafeSpendingTrendChart trend={trend} historical />);
		expect(screen.getByText("Over historical budget · $16 a day")).toBeTruthy();
		expect(screen.getByText("Spending so far")).toBeTruthy();
		expect(screen.getByText("Historical budget $400")).toBeTruthy();
		expect(screen.getByText("Protected reserve starts $300")).toBeTruthy();
		const description = screen
			.getByRole("img", { name: "Card spending pace" })
			.querySelector("desc")?.textContent;
		expect(description).toContain("historical budget was crossed");
		expect(description).not.toContain("spending limit");
	});
});
