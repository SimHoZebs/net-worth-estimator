import { describe, expect, it } from "vitest";
import type { BackendCheckpoint } from "../api/contracts.ts";
import { projectionFixture } from "../mocks/projection.ts";
import { netWorthChangeSinceFirstSync } from "./netWorthChange.ts";

const checkpoints: BackendCheckpoint[] = [
	{ Date: "2026-07-01", AccountId: "cash", Balance: 1800, source: "simplefin" },
	{ Date: "2026-01-01", AccountId: "cash", Balance: 100, source: "user" },
	{ Date: "2026-02-01", AccountId: "cash", Balance: 1500, source: "simplefin" },
	{ Date: "2026-02-01", AccountId: "debt", Balance: -500, source: "simplefin" },
];
const points = [
	{ date: "2026-01-01", total: 100, balances: {} },
	{ date: "2026-02-01", total: 1000, balances: {} },
	{ date: "2026-07-01", total: 1800, balances: {} },
	{ date: "2046-07-01", total: 100000, balances: {} },
];

describe("net worth change since first sync", () => {
	it("uses the first synced engine total, not older history or a future total", () => {
		expect(
			netWorthChangeSinceFirstSync(
				projectionFixture({ points, currentNetWorth: 1800 }),
				checkpoints,
			),
		).toEqual({ date: "2026-02-01", amount: 800, fraction: 0.8 });
	});
	it.each([
		[1000, 800, -200, -0.2],
		[1000, 1000, 0, 0],
		[-1000, -800, 200, 0.2],
		[-1000, -1200, -200, -0.2],
		[0, 200, 200, null],
		[0, 0, 0, null],
	])(
		"compares baseline %s with current %s",
		(baseline, current, amount, fraction) => {
			expect(
				netWorthChangeSinceFirstSync(
					projectionFixture({
						points: [{ date: "2026-02-01", total: baseline, balances: {} }],
						currentNetWorth: current,
					}),
					checkpoints,
				),
			).toEqual({ date: "2026-02-01", amount, fraction });
		},
	);
	it("does not invent a first sync for manual or missing observations", () => {
		const projection = projectionFixture({ points });
		expect(netWorthChangeSinceFirstSync(projection, [])).toBeNull();
		expect(
			netWorthChangeSinceFirstSync(
				projection,
				checkpoints.map((checkpoint) => ({ ...checkpoint, source: "user" })),
			),
		).toBeNull();
	});
	it("requires an exact engine baseline instead of a nearby or filled point", () => {
		expect(
			netWorthChangeSinceFirstSync(
				projectionFixture({
					points: points.filter((point) => point.date !== "2026-02-01"),
				}),
				checkpoints,
			),
		).toBeNull();
	});
});
