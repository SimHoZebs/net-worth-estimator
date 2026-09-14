import { describe, expect, it } from "vitest";
import { parseFinancialModelDocument } from "@/lib/projection/sources/csv/csvDataSource";

// Live end-to-end check: fetch the canonical document from the Go backend and
// drive it through the backend projection endpoints used by the app.
// Opt-in: set NET_WORTH_ESTIMATOR_LIVE_TESTS=1 with the dev server (or
// backend) reachable; skipped otherwise so default runs stay hermetic.

const LIVE_BACKEND = process.env.NET_WORTH_ESTIMATOR_LIVE_TESTS;

const API = "http://127.0.0.1:5173/v1";

const EMPTY_OVERRIDES = {
	addedAccounts: [],
	addedPostings: [],
	disabledAccountIds: [],
	disabledPostingIds: [],
};

const SETTINGS = {
	fallbackProjectionStartDate: "2026-08-22",
	horizonYears: 3,
	evaluations: {
		financialIndependence: [],
		netWorthThreshold: [
			{
				instanceId: "nw",
				label: "1M",
				enabled: true,
				config: { target: 1_000_000 },
			},
		],
		postingFulfillment: [
			{
				instanceId: "pf",
				label: "PF",
				enabled: true,
				config: { postingIds: null },
			},
		],
	},
};

describe.skipIf(!LIVE_BACKEND)("live backend parity", () => {
	it("parses the served document with the production parser", async () => {
		const response = await fetch(`${API}/financial-model`);
		expect(response.ok).toBe(true);
		const body = (await response.json()) as {
			document: unknown;
			issues: unknown[];
		};
		const document = parseFinancialModelDocument(body.document);
		expect(document).not.toBeNull();
		expect(document!.accounts.length).toBeGreaterThan(0);
	});

	it("projects the fetched document through the backend engine", async () => {
		const response = await fetch(`${API}/financial-model`);
		const body = (await response.json()) as { document: unknown };
		const projection = await fetch(`${API}/projections/deterministic`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				document: body.document,
				overrides: EMPTY_OVERRIDES,
				settings: SETTINGS,
			}),
		});
		expect(projection.ok).toBe(true);
		const payload = (await projection.json()) as {
			result?: { timeline?: { rows?: unknown[] } };
			error?: string;
		};
		expect(payload.error ?? null).toBeNull();
		expect(payload.result?.timeline?.rows?.length ?? 0).toBeGreaterThan(0);
	});

	it("streams a seeded stochastic projection", async () => {
		const response = await fetch(`${API}/projections/stochastic`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "text/event-stream",
			},
			body: JSON.stringify({
				overrides: EMPTY_OVERRIDES,
				settings: SETTINGS,
				config: { runCount: 1, seed: 1 },
			}),
		});
		expect(response.ok).toBe(true);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		const stream = await response.text();
		expect(stream).toContain("event: result");
	});
});
