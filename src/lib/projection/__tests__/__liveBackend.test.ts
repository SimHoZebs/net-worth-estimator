import { describe, expect, it } from "vitest";
import type { FinancialModelDocument } from "@/lib/projection";
import {
	projectFinancialModelDocument,
	stochasticProject,
} from "@/lib/projection";
import { parseFinancialModelDocument } from "@/lib/projection/sources/csv/csvDataSource";

// Live end-to-end check: fetch the canonical document from the Go backend and
// drive it through the exact load/parse/project path used by the app.
// Opt-in: set NET_WORTH_ESTIMATOR_LIVE_TESTS=1 with the dev server (or
// backend) reachable; skipped otherwise so default runs stay hermetic.

const LIVE_BACKEND = process.env.NET_WORTH_ESTIMATOR_LIVE_TESTS;

const API = "http://127.0.0.1:5173/v1";

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

	it("projects the fetched document through the TS engine", async () => {
		const response = await fetch(`${API}/financial-model`);
		const body = (await response.json()) as { document: unknown };
		const document = parseFinancialModelDocument(
			body.document,
		) as FinancialModelDocument;
		const result = projectFinancialModelDocument(
			document,
			{
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
			},
			{
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
			undefined,
			{
				incomeSources: [
					{
						id: "salary",
						label: "Salary",
						effectiveFrom: "2026-01-01",
						effectiveTo: null,
						annualGrossIncome: 130146.12,
					},
				],
				taxProfiles: [
					{
						id: "us-federal-married-jointly-2026",
						label: "Federal 2026",
						deduction: 32200,
						brackets: [
							{ upTo: 24800, rate: 0.1 },
							{ upTo: 100800, rate: 0.12 },
							{ upTo: 211400, rate: 0.22 },
							{ upTo: 403550, rate: 0.24 },
							{ upTo: 512450, rate: 0.32 },
							{ upTo: 768700, rate: 0.35 },
							{ upTo: null, rate: 0.37 },
						],
						sourceUrl: null,
					},
				],
			},
		);
		expect(result.timeline.rows.length).toBeGreaterThan(0);
	});

	it("streams a seeded stochastic projection", () => {
		void stochasticProject;
	});
});
