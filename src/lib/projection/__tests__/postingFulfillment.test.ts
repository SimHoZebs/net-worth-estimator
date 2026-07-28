import { describe, expect, it } from "vitest";
import {
	DEFAULT_POSTING_FULFILLMENT_INSTANCE_ID,
	getPostingFulfillmentResult,
	projectFinancialModelDocument,
} from "../";
import {
	createBaseDocument,
	makeAccount,
	makePosting,
	makeSettings,
} from "../__fixtures__";
import {
	evaluatePostingFulfillment,
	postingFulfillmentEvaluation,
	validatePostingFulfillmentConfig,
} from "../evaluation/postingFulfillment";
import { projectRawFinancialModelDocument } from "../simulation/projectPath";

function constrainedPath() {
	const document = createBaseDocument({
		accounts: [
			makeAccount({ id: "checking", minBalance: 0 }),
			makeAccount({ id: "loan", maxBalance: 0 }),
		],
		checkpoints: [
			{ Date: "2026-01-01", AccountId: "checking", Balance: 250 },
			{ Date: "2026-01-01", AccountId: "loan", Balance: -300 },
		],
		postings: [
			makePosting({
				id: "payment",
				label: "Payment",
				sourceAccountId: "checking",
				destinations: ["loan"],
				arithmetic: "400",
				startDate: "2026-01-10",
				endDate: "2026-01-10",
			}),
		],
	});
	return projectRawFinancialModelDocument(document, makeSettings()).path;
}

describe("posting fulfillment evaluation", () => {
	it("derives deterministic fulfillment evidence from movement facts", () => {
		const result = evaluatePostingFulfillment(constrainedPath(), {
			postingIds: null,
		});

		expect(result).toMatchObject({
			requestedAmount: 400,
			realizedAmount: 250,
			unfulfilledAmount: 150,
			completionRate: 0.625,
			firstUnderfulfilledDate: "2026-01-10",
			dates: [
				{
					date: "2026-01-10",
					requestedAmount: 400,
					realizedAmount: 250,
					unfulfilledAmount: 150,
				},
			],
			postings: [
				{
					postingId: "payment",
					requestedAmount: 400,
					realizedAmount: 250,
					firstUnderfulfilledDate: "2026-01-10",
					unfulfilledAmount: 150,
				},
			],
		});
		expect(result.events[0]).toMatchObject({
			postingId: "payment",
			bindingConstraints: [{ type: "source-floor", accountId: "checking" }],
			accountDeltas: [
				{ accountId: "checking", delta: -250 },
				{ accountId: "loan", delta: 250 },
			],
		});
	});

	it("supports explicit posting selection", () => {
		const result = evaluatePostingFulfillment(constrainedPath(), {
			postingIds: [],
		});

		expect(result.requestedAmount).toBe(0);
		expect(result.completionRate).toBe(1);
		expect(result.events).toEqual([]);
		expect(result.postings).toEqual([]);
	});

	it("treats a reached destination ceiling as satisfied rather than underfulfilled", () => {
		const document = createBaseDocument({
			accounts: [
				makeAccount({ id: "checking", minBalance: 0 }),
				makeAccount({ id: "loan", maxBalance: 0 }),
			],
			checkpoints: [
				{ Date: "2026-01-01", AccountId: "checking", Balance: 400 },
				{ Date: "2026-01-01", AccountId: "loan", Balance: -300 },
			],
			postings: [
				makePosting({
					id: "payoff",
					sourceAccountId: "checking",
					destinations: ["loan"],
					arithmetic: "400",
					startDate: "2026-01-10",
					endDate: "2026-01-10",
				}),
			],
		});
		const path = projectRawFinancialModelDocument(
			document,
			makeSettings(),
		).path;
		const result = evaluatePostingFulfillment(path, { postingIds: null });

		expect(path.movementEvents[0]).not.toHaveProperty("bindingConstraints");
		expect(result).toMatchObject({
			requestedAmount: 400,
			realizedAmount: 300,
			destinationLimitedAmount: 100,
			unfulfilledAmount: 0,
			completionRate: 1,
			firstUnderfulfilledDate: null,
		});
		expect(result.events[0]?.bindingConstraints).toEqual([
			{ type: "destination-ceiling", accountIds: ["loan"] },
		]);
	});

	it("lets destination completion dominate a tied source floor", () => {
		const document = createBaseDocument({
			accounts: [
				makeAccount({ id: "checking", minBalance: 0 }),
				makeAccount({ id: "loan", maxBalance: 0 }),
			],
			checkpoints: [
				{ Date: "2026-01-01", AccountId: "checking", Balance: 300 },
				{ Date: "2026-01-01", AccountId: "loan", Balance: -300 },
			],
			postings: [
				makePosting({
					id: "payoff",
					sourceAccountId: "checking",
					destinations: ["loan"],
					arithmetic: "400",
					startDate: "2026-01-10",
					endDate: "2026-01-10",
				}),
			],
		});
		const result = evaluatePostingFulfillment(
			projectRawFinancialModelDocument(document, makeSettings()).path,
			{ postingIds: null },
		);

		expect(result.unfulfilledAmount).toBe(0);
		expect(result.destinationLimitedAmount).toBe(100);
		expect(result.events[0]?.bindingConstraints).toEqual([
			{ type: "source-floor", accountId: "checking" },
			{ type: "destination-ceiling", accountIds: ["loan"] },
		]);
	});

	it("reconstructs same-date balances and diagnoses annual caps", () => {
		const document = createBaseDocument({
			accounts: [
				makeAccount({ id: "checking", minBalance: 0 }),
				makeAccount({ id: "loan", maxBalance: 0 }),
				makeAccount({ id: "brokerage" }),
			],
			checkpoints: [
				{ Date: "2026-01-01", AccountId: "checking", Balance: 1_000 },
				{ Date: "2026-01-01", AccountId: "loan", Balance: -150 },
			],
			postings: [
				makePosting({
					id: "loan-payment-1",
					sourceAccountId: "checking",
					destinations: ["loan"],
					arithmetic: "100",
					priority: 0,
					startDate: "2026-01-10",
					endDate: "2026-01-10",
				}),
				makePosting({
					id: "loan-payment-2",
					sourceAccountId: "checking",
					destinations: ["loan"],
					arithmetic: "100",
					priority: 1,
					startDate: "2026-01-10",
					endDate: "2026-01-10",
				}),
				makePosting({
					id: "capped-transfer",
					sourceAccountId: "checking",
					destinations: ["brokerage"],
					arithmetic: "200",
					annualCap: 100,
					priority: 2,
					startDate: "2026-01-10",
					endDate: "2026-01-10",
				}),
			],
		});
		const result = evaluatePostingFulfillment(
			projectRawFinancialModelDocument(document, makeSettings()).path,
			{ postingIds: null },
		);

		expect(result.events[1]).toMatchObject({
			postingId: "loan-payment-2",
			realizedAmount: 50,
			destinationLimitedAmount: 50,
			unfulfilledAmount: 0,
			bindingConstraints: [
				{ type: "destination-ceiling", accountIds: ["loan"] },
			],
		});
		expect(result.events[2]).toMatchObject({
			postingId: "capped-transfer",
			realizedAmount: 100,
			unfulfilledAmount: 100,
			bindingConstraints: [{ type: "action-limit" }],
		});
	});

	it("validates config and aggregates stochastic outcomes", () => {
		expect(validatePostingFulfillmentConfig({})).toEqual({ postingIds: null });
		expect(() =>
			validatePostingFulfillmentConfig({ postingIds: [""] }),
		).toThrow(/postingIds/u);

		const deterministic = evaluatePostingFulfillment(constrainedPath(), {
			postingIds: null,
		});
		const accumulator = postingFulfillmentEvaluation.createAccumulator(
			{ postingIds: null },
			deterministic,
		);
		postingFulfillmentEvaluation.accumulate(accumulator, deterministic);
		postingFulfillmentEvaluation.accumulate(accumulator, {
			...deterministic,
			unfulfilledAmount: 0,
			firstUnderfulfilledDate: null,
		});
		const probabilistic = postingFulfillmentEvaluation.finalize(accumulator, {
			document: constrainedPath().effectiveDocument,
			deterministicPath: constrainedPath(),
			runCount: 2,
		});

		expect(probabilistic).toMatchObject({
			runCount: 2,
			fulfilledRunCount: 1,
			fullFulfillmentProbability: 0.5,
			unfulfilledAmountPercentiles: { p50: 75 },
		});
	});

	it("uses whole-dollar reporting precision consistently", () => {
		const path = constrainedPath();
		const event = path.movementEvents[0]!;
		const belowThreshold = evaluatePostingFulfillment(
			{
				...path,
				movementEvents: [
					{ ...event, requestedAmount: 100, realizedAmount: 99.501 },
				],
			},
			{ postingIds: null },
		);
		const atThreshold = evaluatePostingFulfillment(
			{
				...path,
				movementEvents: [
					{ ...event, requestedAmount: 100, realizedAmount: 99.5 },
				],
			},
			{ postingIds: null },
		);

		expect(belowThreshold).toMatchObject({
			requestedAmount: 100,
			realizedAmount: 100,
			unfulfilledAmount: 0,
			completionRate: 1,
			firstUnderfulfilledDate: null,
		});
		expect(atThreshold).toMatchObject({
			requestedAmount: 100,
			realizedAmount: 100,
			unfulfilledAmount: 1,
			completionRate: 0.995,
			firstUnderfulfilledDate: event.date,
		});
	});

	it("avoids detailed report allocation for stochastic paths", () => {
		const path = constrainedPath();
		const result = postingFulfillmentEvaluation.evaluatePath(
			{
				path,
				document: path.effectiveDocument,
				detailLevel: "summary",
			},
			{ postingIds: null },
		);

		expect(result).toMatchObject({
			unfulfilledAmount: 150,
			firstUnderfulfilledDate: "2026-01-10",
			events: [],
			dates: [],
			postings: [],
		});
		expect(DEFAULT_POSTING_FULFILLMENT_INSTANCE_ID).toBe("posting-fulfillment");
	});

	it("supports an explicitly designated all-postings dashboard instance", () => {
		const document = constrainedPath().effectiveDocument;
		const result = projectFinancialModelDocument(
			document,
			makeSettings({
				evaluations: {
					financialIndependence: [],
					netWorthThreshold: [],
					postingFulfillment: [
						{
							instanceId: "scoped",
							label: "Scoped",
							enabled: true,
							config: { postingIds: [] },
						},
						{
							instanceId: DEFAULT_POSTING_FULFILLMENT_INSTANCE_ID,
							label: "All postings",
							enabled: true,
							config: { postingIds: null },
						},
					],
				},
			}),
		);

		expect(
			getPostingFulfillmentResult(result)?.deterministic?.requestedAmount,
		).toBe(0);
		expect(
			getPostingFulfillmentResult(
				result,
				DEFAULT_POSTING_FULFILLMENT_INSTANCE_ID,
			)?.deterministic?.unfulfilledAmount,
		).toBe(150);
	});
});
