import { describe, expect, it } from "vitest";
import type { PostingObservationDataset } from "../postingObservations";
import type { PayrollCandidate } from "./payrollDetection";
import { payrollDetectionAnalysis } from "./payrollDetection";
import { salaryEstimateAnalysis } from "./salaryEstimate";
import { transactionClassificationAnalysis } from "./transactionClassification";

function candidate(
	dates: string[],
	amounts: number[] = dates.map(() => 2000),
): PayrollCandidate {
	return {
		key: "checking:USD:acme",
		accountId: "checking",
		currency: "USD",
		payerLabel: "Acme Inc",
		transactions: dates.map((bookedDate, index) => ({
			id: `pay-${index + 1}`,
			bookedDate,
			amount: amounts[index]!,
		})),
		identityEvidence: { strength: "strong", items: [] },
		regularityEvidence: { strength: "strong", items: [] },
		recurring: true,
	};
}

async function detectPayroll(input: PostingObservationDataset) {
	const classified = await transactionClassificationAnalysis.run({ input });
	return payrollDetectionAnalysis.run({ input: classified.value });
}

describe("salary estimate analysis", () => {
	it("annualizes a biweekly recurring net-pay stream", async () => {
		const result = await salaryEstimateAnalysis.run({
			input: {
				candidates: [
					candidate(["2026-01-02", "2026-01-16", "2026-01-30", "2026-02-13"]),
				],
			},
		});
		expect(result.value.estimate).toMatchObject({
			cadence: "biweekly",
			typicalNetDeposit: 2000,
			annualizedObservedNetPay: {
				low: 52_000,
				midpoint: 52_000,
				high: 52_000,
			},
		});
	});

	it("prefers a validated twice-monthly calendar pattern", async () => {
		const result = await salaryEstimateAnalysis.run({
			input: {
				candidates: [
					candidate(["2026-02-01", "2026-02-28", "2026-03-01", "2026-03-31"]),
				],
			},
		});
		expect(result.value.estimate).toMatchObject({
			cadence: "twice-monthly",
			annualizedObservedNetPay: {
				midpoint: 48_000,
			},
		});
	});

	it("does not choose biweekly over indistinguishable twice-monthly timing", async () => {
		const result = await salaryEstimateAnalysis.run({
			input: {
				candidates: [
					candidate(["2026-02-01", "2026-02-15", "2026-03-01", "2026-03-15"]),
				],
			},
		});
		expect(result.value.estimate).toBeNull();
		expect(result.diagnostics[0]?.code).toBe("salary.ambiguous-cadence");
	});

	it("rejects calendar schedules with an extra observed deposit", async () => {
		const result = await salaryEstimateAnalysis.run({
			input: {
				candidates: [
					candidate([
						"2026-01-01",
						"2026-01-15",
						"2026-02-01",
						"2026-02-15",
						"2026-03-01",
						"2026-03-15",
						"2026-04-01",
						"2026-04-15",
						"2026-04-25",
					]),
				],
			},
		});
		expect(result.value.estimate).toBeNull();
		expect(result.diagnostics[0]?.code).toBe("salary.ambiguous-cadence");
	});

	it("rejects calendar schedules with skipped months", async () => {
		const result = await salaryEstimateAnalysis.run({
			input: {
				candidates: [
					candidate(["2026-01-01", "2026-01-15", "2026-03-01", "2026-03-15"]),
				],
			},
		});
		expect(result.value.estimate).toBeNull();
		expect(result.diagnostics[0]?.code).toBe("salary.ambiguous-cadence");
	});

	it("rejects two clustered deposits per month as twice-monthly pay", async () => {
		const result = await salaryEstimateAnalysis.run({
			input: {
				candidates: [
					candidate(["2026-01-01", "2026-01-02", "2026-02-01", "2026-02-02"]),
				],
			},
		});
		expect(result.value.estimate).toBeNull();
		expect(result.diagnostics[0]?.code).toBe("salary.ambiguous-cadence");
	});

	it("does not hide an extra high-value deposit before calendar validation", async () => {
		const result = await salaryEstimateAnalysis.run({
			input: {
				candidates: [
					candidate(
						[
							"2026-01-01",
							"2026-01-15",
							"2026-01-25",
							"2026-02-01",
							"2026-02-15",
							"2026-03-01",
							"2026-03-15",
						],
						[2000, 2000, 10_000, 2000, 2000, 2000, 2000],
					),
				],
			},
		});
		expect(result.value.estimate).toBeNull();
		expect(result.diagnostics[0]?.code).toBe("salary.ambiguous-cadence");
	});

	it("rejects weak twice-monthly evidence without a calendar pattern", async () => {
		const result = await salaryEstimateAnalysis.run({
			input: {
				candidates: [
					candidate([
						"2026-01-02",
						"2026-01-16",
						"2026-01-30",
						"2026-02-13",
						"2026-02-26",
						"2026-03-12",
					]),
				],
			},
		});
		expect(result.value.estimate).toBeNull();
		expect(result.diagnostics[0]?.code).toBe("salary.ambiguous-cadence");
	});

	it("rejects unsupported fixed intervals that resemble weekly or monthly pay", async () => {
		const everyFiveDays = await salaryEstimateAnalysis.run({
			input: {
				candidates: [
					candidate(["2026-01-01", "2026-01-06", "2026-01-11", "2026-01-16"]),
				],
			},
		});
		expect(everyFiveDays.value.estimate).toBeNull();
		expect(everyFiveDays.diagnostics[0]?.code).toBe("salary.ambiguous-cadence");

		const everyTwentyFiveDays = await salaryEstimateAnalysis.run({
			input: {
				candidates: [
					candidate(["2026-01-01", "2026-01-26", "2026-02-20", "2026-03-17"]),
				],
			},
		});
		expect(everyTwentyFiveDays.value.estimate).toBeNull();
		expect(everyTwentyFiveDays.diagnostics[0]?.code).toBe(
			"salary.ambiguous-cadence",
		);
	});

	it("excludes an off-cycle amount outlier from a monthly estimate", async () => {
		const result = await salaryEstimateAnalysis.run({
			input: {
				candidates: [
					candidate(
						[
							"2026-01-31",
							"2026-02-15",
							"2026-02-28",
							"2026-03-31",
							"2026-04-30",
						],
						[3000, 9000, 3000, 3000, 3000],
					),
				],
			},
		});
		expect(result.value.estimate).toMatchObject({
			cadence: "monthly",
			annualizedObservedNetPay: { midpoint: 36_000 },
			excludedTransactionIds: ["pay-2"],
		});
		expect(result.diagnostics[0]?.code).toBe(
			"salary.off-cycle-payments-excluded",
		);
	});

	it("does not combine two recurring amount modes", async () => {
		const result = await salaryEstimateAnalysis.run({
			input: {
				candidates: [
					candidate(
						["2026-01-02", "2026-01-16", "2026-01-30", "2026-02-13"],
						[2000, 2000, 4000, 4000],
					),
				],
			},
		});
		expect(result.value.estimate).toBeNull();
		expect(result.diagnostics[0]?.code).toBe("salary.multimodal-deposits");
	});

	it("excludes a singleton high-side amount outlier", async () => {
		const result = await salaryEstimateAnalysis.run({
			input: {
				candidates: [
					candidate(
						["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"],
						[2000, 2000, 2000, 3000],
					),
				],
			},
		});
		expect(result.value.estimate).toMatchObject({
			annualizedObservedNetPay: { midpoint: 24_000 },
			excludedTransactionIds: ["pay-4"],
		});
	});

	it("keeps the robust outlier path available after payroll detection", async () => {
		const dates = [
			"2026-01-31",
			"2026-02-15",
			"2026-02-28",
			"2026-03-31",
			"2026-04-30",
		];
		const detected = await detectPayroll({
			postings: dates.map((bookedDate, index) => ({
				id: `observed-${index}`,
				postingId: `observed-${index}`,
				accountId: "checking",
				bookedDate,
				amount: index === 1 ? 9000 : 3000,
				currency: "USD" as const,
				description: "ACME PAYROLL",
				counterpartyName: "Acme Inc",
			})),
		});
		const result = await salaryEstimateAnalysis.run({ input: detected.value });
		expect(result.value.estimate?.annualizedObservedNetPay?.midpoint).toBe(
			36_000,
		);
	});

	it("keeps a strong payroll identity provisional with only two regular deposits", async () => {
		const detected = await detectPayroll({
			postings: [
				{
					id: "amazon-april",
					postingId: "amazon-april",
					accountId: "checking",
					bookedDate: "2026-04-30",
					amount: 41330.61,
					currency: "USD",
					description: "AMAZON DEVELOPME PAYROLL PPD ID: 9111111103",
					counterpartyName: "ACH credit",
				},
				{
					id: "amazon-june",
					postingId: "amazon-june",
					accountId: "checking",
					bookedDate: "2026-06-30",
					amount: 7455.96,
					currency: "USD",
					description: "AMAZON DEVELOPME PAYROLL PPD ID: 9111111103",
					counterpartyName: "ACH credit",
				},
				{
					id: "amazon-july",
					postingId: "amazon-july",
					accountId: "checking",
					bookedDate: "2026-07-31",
					amount: 7579.38,
					currency: "USD",
					description: "AMAZON DEVELOPME PAYROLL PPD ID: 9111111103",
					counterpartyName: "ACH credit",
				},
			],
		});
		const result = await salaryEstimateAnalysis.run({ input: detected.value });
		expect(result.value).toMatchObject({
			status: "provisional",
			estimate: {
				typicalNetDeposit: (7455.96 + 7579.38) / 2,
				annualizedObservedNetPay: null,
				identityEvidence: { strength: "moderate" },
				regularPayEvidence: { strength: "weak" },
				excludedTransactionIds: ["amazon-april"],
			},
		});
	});

	it("returns no estimate for insufficient or ambiguous history", async () => {
		const insufficient = await salaryEstimateAnalysis.run({
			input: { candidates: [candidate(["2026-01-01"])] },
		});
		expect(insufficient.value.estimate).toBeNull();
		expect(insufficient.diagnostics[0]?.code).toBe(
			"salary.insufficient-history",
		);

		const irregular = await salaryEstimateAnalysis.run({
			input: {
				candidates: [
					candidate(["2026-01-01", "2026-01-11", "2026-02-08", "2026-03-25"]),
				],
			},
		});
		expect(irregular.value.estimate).toBeNull();
		expect(irregular.diagnostics[0]?.code).toBe("salary.ambiguous-cadence");
	});

	it("returns a provisional per-deposit result with two comparable deposits", async () => {
		const result = await salaryEstimateAnalysis.run({
			input: {
				candidates: [candidate(["2026-06-30", "2026-07-31"])],
			},
		});
		expect(result.value).toMatchObject({
			status: "provisional",
			estimate: {
				typicalNetDeposit: 2000,
				annualizedObservedNetPay: null,
				comparableObservationCount: 2,
			},
		});
		expect(result.value.estimate?.limitations).toContain(
			"This is a per-deposit estimate only; annualization is withheld until more comparable history is available.",
		);
	});

	it("rejects a cadence-breaking gap hidden by a median", async () => {
		const result = await salaryEstimateAnalysis.run({
			input: {
				candidates: [
					candidate([
						"2026-01-02",
						"2026-01-16",
						"2026-01-30",
						"2026-02-13",
						"2026-03-13",
					]),
				],
			},
		});
		expect(result.value.estimate).toBeNull();
		expect(result.diagnostics[0]?.code).toBe("salary.ambiguous-cadence");
	});
});
