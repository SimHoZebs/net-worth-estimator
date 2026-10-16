import { describe, expect, it } from "vitest";
import {
	compareTransactionDates,
	DEFAULT_TRANSACTION_ORDER,
	sortTransactionsByDate,
	toggleTransactionOrder,
} from "./transactionSort.ts";

describe("transaction sorting", () => {
	it("defaults to newest first", () => {
		expect(DEFAULT_TRANSACTION_ORDER).toBe("newest");
	});

	it("toggles between newest and oldest", () => {
		expect(toggleTransactionOrder("newest")).toBe("oldest");
		expect(toggleTransactionOrder("oldest")).toBe("newest");
	});

	it("sorts dates newest first by default with a stable id tie-breaker", () => {
		const rows = [
			{ date: "2026-08-28", id: "b" },
			{ date: "2026-09-28", id: "a" },
			{ date: "2026-08-28", id: "a" },
		];
		const ordered = sortTransactionsByDate({
			items: rows,
			getDate: (row) => row.date,
			getId: (row) => row.id,
		});
		expect(ordered.map((row) => row.id)).toEqual(["a", "a", "b"]);
		expect(rows[0]?.id).toBe("b");
	});

	it("sorts oldest first when requested", () => {
		const rows = [{ date: "2026-09-28" }, { date: "2026-08-28" }];
		const ordered = sortTransactionsByDate({
			items: rows,
			getDate: (row) => row.date,
			order: "oldest",
		});
		expect(ordered.map((row) => row.date)).toEqual([
			"2026-08-28",
			"2026-09-28",
		]);
	});

	it("compares single dates in either direction", () => {
		expect(
			compareTransactionDates({
				aDate: "2026-09-01",
				bDate: "2026-08-01",
				order: "newest",
			}),
		).toBeLessThan(0);
		expect(
			compareTransactionDates({
				aDate: "2026-09-01",
				bDate: "2026-08-01",
				order: "oldest",
			}),
		).toBeGreaterThan(0);
	});
});
