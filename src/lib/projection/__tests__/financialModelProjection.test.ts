import { describe, expect, it } from "vitest";
import {
	getPostingFulfillmentResult,
	type PostingFulfillmentPathResult,
	type ProjectionResult,
	projectFinancialModelDocument,
} from "../";
import {
	createBaseDocument,
	makeAccount,
	makePosting,
	makeSettings,
} from "../__fixtures__";
import { NO_CEILING, NO_FLOOR } from "../constants";
import { projectRawFinancialModelDocument } from "../simulation/projectPath";

function getBalance(
	row:
		| { accountSnapshots: Array<{ accountId: string; balance: number }> }
		| undefined,
	accountId: string,
): number {
	return (
		row?.accountSnapshots?.find((s) => s.accountId === accountId)?.balance ?? 0
	);
}

function fulfillment(result: ProjectionResult): PostingFulfillmentPathResult {
	const value = getPostingFulfillmentResult(result)?.deterministic;
	if (!value) throw new Error("Expected posting fulfillment result.");
	return value;
}

function postingEvent(
	result: ProjectionResult,
	postingId: string,
	date?: string,
) {
	return fulfillment(result).events.find(
		(event) => event.postingId === postingId && (!date || event.date === date),
	);
}

describe("financial model projection engine", () => {
	it("builds dated checkpoint rows and future event rows from real postings", () => {
		const result = projectFinancialModelDocument(
			createBaseDocument(),
			makeSettings(),
		);

		expect(result.timeline.rows.map((row) => row.date)).toEqual([
			"2026-01-31",
			"2026-02-05",
			"2026-02-06",
			"2026-02-10",
			"2026-02-20",
		]);
		expect(result.timeline.rows[0]?.isHistorical).toBe(true);
		expect(result.timeline.rows[0]?.netWorth).toBe(1600);
		expect(result.timeline.rows[1]?.externalInflowAmount).toBe(1000);
		expect(getBalance(result.timeline.rows[1], "checking")).toBe(1800);
		expect(result.timeline.rows[2]?.externalOutflowAmount).toBe(200);
		expect(getBalance(result.timeline.rows[2], "checking")).toBe(1600);
		expect(result.timeline.rows[3]?.internalTransferAmount).toBe(900);
		expect(getBalance(result.timeline.rows[3], "brokerage")).toBe(2100);
		expect(postingEvent(result, "paydown")?.requestedAmount).toBe(250);
		expect(postingEvent(result, "paydown")?.realizedAmount).toBe(250);
		expect(getBalance(result.timeline.rows[4], "loan")).toBe(-150);
		expect(result.summary.currentNetWorth).toBe(1600);
		expect(result.summary.finalNetWorth).toBe(2400);
		expect(result.milestones.projectionStartDate).toBe("2026-01-31");
	});

	it("applies annual caps per calendar year on dated postings", () => {
		const document = createBaseDocument({
			checkpoints: [],
			accounts: [
				makeAccount({ id: "checking" }),
				makeAccount({ id: "brokerage" }),
			],
			postings: [
				makePosting({
					id: "salary",
					destinations: ["checking"],
					arithmetic: "1000",
					startDate: "2026-01-01",
				}),
				makePosting({
					id: "capped",
					sourceAccountId: "checking",
					destinations: ["brokerage"],
					arithmetic: "200",
					startDate: "2026-01-15",
					annualCap: 500,
					priority: 2,
				}),
			],
		});

		const result = projectFinancialModelDocument(
			document,
			makeSettings({ horizonYears: 2 }),
		);

		expect(postingEvent(result, "capped", "2026-01-15")?.realizedAmount).toBe(
			200,
		);
		expect(postingEvent(result, "capped", "2026-02-15")?.realizedAmount).toBe(
			200,
		);
		expect(postingEvent(result, "capped", "2026-03-15")?.realizedAmount).toBe(
			100,
		);
		expect(postingEvent(result, "capped", "2026-04-15")?.realizedAmount).toBe(
			0,
		);
		expect(postingEvent(result, "capped", "2027-01-15")?.realizedAmount).toBe(
			200,
		);
	});

	it("supports same-day percent_of_base chains in priority order", () => {
		const document = createBaseDocument({
			checkpoints: [],
			accounts: [makeAccount({ id: "checking" }), makeAccount({ id: "k401" })],
			postings: [
				makePosting({
					id: "salary",
					destinations: ["checking"],
					arithmetic: "1000",
					startDate: "2026-01-10",
					endDate: "2026-01-10",
				}),
				makePosting({
					id: "employee_k401",
					destinations: ["k401"],
					arithmetic: "salary * 0.1",
					startDate: "2026-01-10",
					endDate: "2026-01-10",
					priority: 2,
				}),
				makePosting({
					id: "employer_match",
					destinations: ["k401"],
					arithmetic: "employee_k401 * 0.5",
					startDate: "2026-01-10",
					endDate: "2026-01-10",
					priority: 3,
				}),
			],
		});

		const result = projectFinancialModelDocument(document, makeSettings());

		expect(postingEvent(result, "employee_k401")?.requestedAmount).toBe(100);
		expect(postingEvent(result, "employer_match")?.requestedAmount).toBe(50);
		expect(result.timeline.rows[0]?.externalInflowAmount).toBe(1150);
		expect(getBalance(result.timeline.rows[0], "checking")).toBe(1000);
		expect(getBalance(result.timeline.rows[0], "k401")).toBe(150);
	});

	it("clamps postings by source balance only", () => {
		const document = createBaseDocument({
			checkpoints: [
				{ Date: "2026-01-01", AccountId: "checking", Balance: 250 },
				{ Date: "2026-01-01", AccountId: "loan", Balance: -300 },
			],
			accounts: [
				makeAccount({ id: "checking", minBalance: 0 }),
				makeAccount({ id: "loan" }),
			],
			postings: [
				makePosting({
					id: "loan_payment",
					sourceAccountId: "checking",
					destinations: ["loan"],
					arithmetic: "400",
					startDate: "2026-01-10",
					endDate: "2026-01-10",
				}),
			],
		});

		const result = projectFinancialModelDocument(document, makeSettings());

		expect(fulfillment(result)).toMatchObject({
			requestedAmount: 400,
			realizedAmount: 250,
			unfulfilledAmount: 150,
		});
		expect(fulfillment(result).postings[0]).toMatchObject({
			postingId: "loan_payment",
			requestedAmount: 400,
			realizedAmount: 250,
			utilizationRate: 0.625,
			firstUnderfulfilledDate: "2026-01-10",
			unfulfilledAmount: 150,
		});
		expect(getBalance(result.timeline.rows[1], "checking")).toBe(0);
		expect(getBalance(result.timeline.rows[1], "loan")).toBe(-50);
		expect(result.timeline.rows[1]?.netWorth).toBe(-50);
	});

	it("throws when source account has null minBalance (fail-fast)", () => {
		const document = createBaseDocument({
			checkpoints: [
				{ Date: "2026-01-01", AccountId: "checking", Balance: 300 },
				{ Date: "2026-01-01", AccountId: "loan", Balance: -200 },
			],
			accounts: [
				{
					id: "checking",
					label: "Checking",
					minBalance: NO_FLOOR,
					maxBalance: NO_CEILING,
					color: null,
					enabled: true,
				},
				{
					id: "loan",
					label: "Loan",
					minBalance: null as unknown as number,
					maxBalance: 0,
					color: null,
					enabled: true,
				},
			],
			postings: [
				makePosting({
					id: "interest",
					sourceAccountId: "loan",
					arithmetic: "100",
					startDate: "2026-01-10",
					endDate: "2026-01-10",
				}),
			],
		});

		expect(() =>
			projectFinancialModelDocument(document, makeSettings()),
		).toThrow("has no minBalance configured");
	});

	it("throws when destination account has null maxBalance (fail-fast)", () => {
		const document = createBaseDocument({
			checkpoints: [
				{ Date: "2026-01-01", AccountId: "checking", Balance: 300 },
				{ Date: "2026-01-01", AccountId: "loan", Balance: -200 },
			],
			accounts: [
				{
					id: "checking",
					label: "Checking",
					minBalance: NO_FLOOR,
					maxBalance: null as unknown as number,
					color: null,
					enabled: true,
				},
				{
					id: "loan",
					label: "Loan",
					minBalance: NO_FLOOR,
					maxBalance: 0,
					color: null,
					enabled: true,
				},
			],
			postings: [
				makePosting({
					id: "payment",
					sourceAccountId: "loan",
					destinations: ["checking"],
					arithmetic: "100",
					startDate: "2026-01-10",
					endDate: "2026-01-10",
				}),
			],
		});

		expect(() =>
			projectFinancialModelDocument(document, makeSettings()),
		).toThrow("has no maxBalance configured");
	});

	it("applies interest via postings with rate keyword", () => {
		const document = createBaseDocument({
			checkpoints: [{ Date: "2026-01-01", AccountId: "loan", Balance: -1200 }],
			accounts: [makeAccount({ id: "loan", minBalance: NO_FLOOR })],
			postings: [
				makePosting({
					id: "loan_interest",
					sourceAccountId: "loan",
					arithmetic: "abs(loan) * rate",
					frequency: "monthly",
					annualRate: 0.12,
					startDate: "2026-02-01",
					endDate: "2026-02-01",
				}),
			],
		});

		const result = projectFinancialModelDocument(document, makeSettings());

		expect(getBalance(result.timeline.rows[1], "loan")).toBe(-1212);
		expect(result.summary.finalNetWorth).toBe(-1212);
	});

	it("applies both interest charge and payment on same date", () => {
		const document = createBaseDocument({
			checkpoints: [
				{ Date: "2026-01-01", AccountId: "checking", Balance: 1000 },
				{ Date: "2026-01-01", AccountId: "loan_interest", Balance: -100 },
				{ Date: "2026-01-01", AccountId: "loan_principal", Balance: -1000 },
			],
			accounts: [
				makeAccount({ id: "checking", minBalance: 0 }),
				makeAccount({ id: "loan_interest", maxBalance: 0 }),
				makeAccount({ id: "loan_principal", maxBalance: 0 }),
			],
			postings: [
				makePosting({
					id: "interest",
					sourceAccountId: "loan_interest",
					arithmetic: "abs(loan_principal) * rate",
					frequency: "monthly",
					annualRate: 0.12,
					startDate: "2026-02-01",
					endDate: "2026-02-01",
					priority: 1,
				}),
				makePosting({
					id: "payment",
					sourceAccountId: "checking",
					destinations: ["loan_interest", "loan_principal"],
					arithmetic: "200",
					frequency: "monthly",
					startDate: "2026-02-01",
					endDate: "2026-02-01",
					priority: 2,
				}),
			],
		});

		const result = projectFinancialModelDocument(document, makeSettings());
		const row = result.timeline.rows[1]!;

		expect(getBalance(row, "loan_interest")).toBeGreaterThan(-100);
		expect(getBalance(row, "loan_principal")).toBeGreaterThan(-1000);
		expect(row.netWorth).toBeGreaterThan(-1100);
		expect(fulfillment(result).realizedAmount).toBe(210);
		expect(getBalance(row, "checking")).toBe(800);
	});

	it("prevents destination accounts from exceeding maxBalance (overpayment guard)", () => {
		const document = createBaseDocument({
			checkpoints: [
				{ Date: "2026-01-01", AccountId: "checking", Balance: 400 },
				{ Date: "2026-01-01", AccountId: "loan", Balance: -300 },
			],
			accounts: [
				makeAccount({ id: "checking" }),
				makeAccount({ id: "loan", maxBalance: 0 }),
			],
			postings: [
				makePosting({
					id: "paydown",
					sourceAccountId: "checking",
					destinations: ["loan"],
					arithmetic: "400",
					startDate: "2026-01-10",
					endDate: "2026-01-10",
				}),
			],
		});

		const result = projectFinancialModelDocument(document, makeSettings());

		expect(fulfillment(result)).toMatchObject({
			requestedAmount: 400,
			realizedAmount: 300,
			destinationLimitedAmount: 100,
			unfulfilledAmount: 0,
			completionRate: 1,
		});
		expect(getBalance(result.timeline.rows[1], "loan")).toBe(0);
		expect(getBalance(result.timeline.rows[1], "checking")).toBe(100);
		expect(result.timeline.rows[1]?.netWorth).toBe(100);
	});

	it("prevents source accounts from falling below minBalance", () => {
		const document = createBaseDocument({
			checkpoints: [
				{ Date: "2026-01-01", AccountId: "checking", Balance: 300 },
			],
			accounts: [
				makeAccount({ id: "checking", minBalance: 100 }),
				makeAccount({ id: "brokerage" }),
			],
			postings: [
				makePosting({
					id: "transfer",
					sourceAccountId: "checking",
					destinations: ["brokerage"],
					arithmetic: "400",
					startDate: "2026-01-10",
					endDate: "2026-01-10",
				}),
			],
		});

		const result = projectFinancialModelDocument(document, makeSettings());
		const raw = projectRawFinancialModelDocument(document, makeSettings());

		expect(fulfillment(result)).toMatchObject({
			realizedAmount: 200,
			unfulfilledAmount: 200,
		});
		expect(getBalance(result.timeline.rows[1], "checking")).toBe(100);
		expect(raw.path.movementEvents).toEqual([
			{
				date: "2026-01-10",
				sequence: 0,
				origin: { type: "posting", postingId: "transfer" },
				requestedAmount: 400,
				realizedAmount: 200,
				accountDeltas: [
					{ accountId: "checking", delta: -200 },
					{ accountId: "brokerage", delta: 200 },
				],
			},
		]);
	});

	it("records fully blocked posting attempts without account impacts", () => {
		const document = createBaseDocument({
			checkpoints: [
				{ Date: "2026-01-01", AccountId: "checking", Balance: 100 },
			],
			accounts: [makeAccount({ id: "checking", minBalance: 100 })],
			postings: [
				makePosting({
					id: "blocked",
					sourceAccountId: "checking",
					arithmetic: "50",
					startDate: "2026-01-10",
					endDate: "2026-01-10",
				}),
			],
		});

		const { path } = projectRawFinancialModelDocument(document, makeSettings());

		expect(path.movementEvents[0]).toMatchObject({
			requestedAmount: 50,
			realizedAmount: 0,
			accountDeltas: [],
		});
	});
});
