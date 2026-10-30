import { describe, expect, it } from "vitest";
import type { ProjectionResult } from "./contracts.ts";
import { modelFixture } from "../mocks/waypointServer.ts";
import { projectionResultToLocal } from "../state/useRemoteProjection.ts";
import { independenceChartModel } from "../domain/independenceChart.ts";
import {
	detailedIndependenceOutcome,
	independenceConfig,
	independenceEnvelope,
	independenceItem,
	independenceRow,
} from "../mocks/financialIndependence.ts";
import {
	financialIndependenceEvaluation,
	financialIndependenceRange,
} from "./financialIndependence.ts";

describe("financial independence evidence mapping", () => {
	it("uses the requested horizon even when the returned timeline slice is empty", () => {
		const model = modelFixture();
		model.evaluations.financialIndependence = [independenceConfig()];
		const result: ProjectionResult = {
			timeline: { rows: [] },
			accountSummaries: [],
			totals: {
				externalInflowAmount: 0,
				externalOutflowAmount: 0,
				internalTransferAmount: 0,
			},
			milestones: {
				projectionStartDate: "2026-02-01",
				latestHistoricalDate: null,
			},
			summary: { currentNetWorth: 0, finalNetWorth: 0 },
			evaluations: {
				financialIndependence: [independenceEnvelope()],
				netWorthThreshold: [],
				accountBalance: [],
				postingFulfillment: [],
			},
		};
		const local = projectionResultToLocal(result, model, 20);
		expect(local.otherEvaluations[0]!.financialIndependence?.endDate).toBe(
			"2046-02-01",
		);
	});
	it("retains the whole coverage path and initially selects the latest candidate, not the first row", () => {
		const analysis = independenceItem().financialIndependence!;
		expect(analysis.candidates).toHaveLength(2);
		expect(analysis.defaultDate).toBe("2036-02-01");
		expect(analysis.candidates[1]).toMatchObject({
			annualIncome: 20000,
			annualWithdrawals: 40000,
			annualCapacity: 60000,
			annualSpending: 80000,
		});
		expect(analysis.candidates[1]!.outcome?.attempted).toBe(false);
	});

	it("selects the engine's detailed candidate and keeps nominal and real principal distinct", () => {
		const envelope = independenceEnvelope({
			rows: [independenceRow(), independenceRow("2037-02-01")],
			runOutcomes: [detailedIndependenceOutcome()],
			milestones: {},
		});
		const analysis = independenceItem(envelope).financialIndependence!;
		expect(analysis.defaultDate).toBe("2036-02-01");
		expect(analysis.candidates[0]!.outcome).toMatchObject({
			startingBalance: 1000000,
			endingBalance: 1100000,
			endingRealBalance: 850000,
			principalPreserved: false,
		});
		expect(analysis.candidates[0]!.outcome?.firstShortfall).toMatchObject({
			date: "2040-03-01",
			shortfall: 2000,
			accountIds: ["cash"],
		});
	});

	it("does not treat skipped branches or later untested start dates as failures", () => {
		const envelope = independenceEnvelope({
			rows: [independenceRow(), independenceRow("2037-02-01")],
			runOutcomes: [
				{
					candidateDate: "2036-02-01",
					status: "ineligible",
					expensesFullyCovered: false,
					principalReplenished: false,
					cycleEstablished: false,
				},
			],
			milestones: {},
		});
		const analysis = independenceItem(envelope).financialIndependence!;
		for (const candidate of analysis.candidates) {
			expect(candidate.outcome?.attempted ?? false).toBe(false);
			expect(candidate.outcome?.trajectory ?? []).toEqual([]);
		}
	});

	it.each([
		[
			{ simulationAttempted: false, firstShortfallDate: null },
			{
				attempted: false,
				insufficientCapacity: true,
				expensesCovered: null,
				principalPreserved: null,
			},
		],
		[
			{ simulationAttempted: true, firstShortfallDate: "2040-03-01" },
			{ attempted: true, expensesCovered: false, principalPreserved: null },
		],
		[
			{ simulationAttempted: true, firstShortfallDate: null },
			{ attempted: true, expensesCovered: true, principalPreserved: false },
		],
	] as const)(
		"interprets summary evidence without invented principal balances: %j",
		(summary, expected) => {
			const envelope = independenceEnvelope({
				rows: [independenceRow()],
				runOutcomes: [
					{
						candidateDate: "2036-02-01",
						status: "summary",
						minimumNetWorthMet: true,
						initialCoverageMet: true,
						cycleEstablished: false,
						...summary,
					},
				],
				milestones: {},
			});
			const analysis = independenceItem(envelope).financialIndependence!;
			expect(analysis.candidates[0]!.outcome).toMatchObject(expected);
			expect(analysis.candidates[0]!.outcome?.endingBalance).toBeNull();
			expect(analysis.candidates[0]!.outcome?.endingRealBalance).toBeNull();
		},
	);

	it("preserves absent numeric evidence and does not draw through incomplete points", () => {
		const envelope = independenceEnvelope({
			rows: [
				independenceRow("2026-02-01"),
				{ date: "2030-02-01" },
				independenceRow(),
			],
			runOutcomes: [],
			milestones: {},
		});
		const analysis = independenceItem(envelope).financialIndependence!;
		expect(analysis.candidates[1]).toMatchObject({
			netWorth: null,
			annualIncome: null,
			annualWithdrawals: null,
			annualSpending: null,
			coverage: null,
			outcome: null,
		});
		const model = independenceChartModel(analysis);
		expect(model.capacityPath.match(/M/g)).toHaveLength(2);
		expect(model.capacityPath).not.toMatch(/NaN|Infinity/);
	});

	it("keeps diagnostics even when evaluation fails before it produces rows", () => {
		const envelope = independenceEnvelope(null);
		envelope.status = "indeterminate";
		envelope.diagnostics = [
			{
				code: "invalid-config",
				severity: "error",
				message: "Configuration needs repair.",
			},
		];
		const item = independenceItem(envelope);
		expect(item.financialIndependence).toMatchObject({
			available: false,
			candidates: [],
			diagnostics: envelope.diagnostics,
		});
		expect(
			financialIndependenceEvaluation(
				independenceConfig(),
				undefined,
				null,
				"2026-02-01",
				"2046-02-01",
			).financialIndependence,
		).toBeNull();
	});

	it("does not substitute a first-coverage date for a self-sustaining milestone", () => {
		const analysis = independenceItem(
			independenceEnvelope({
				rows: [independenceRow()],
				runOutcomes: [],
				milestones: { firstCoverageDate: "2036-02-01" },
			}),
		).financialIndependence!;
		expect(analysis.firstCoverageDate).toBe("2036-02-01");
		expect(analysis.firstSelfSustainingDate).toBeNull();
	});

	it("maps confidence independently and preserves not calculated versus zero percent", () => {
		expect(
			financialIndependenceRange(independenceEnvelope(), 400).probability,
		).toBeNull();
		const envelope = independenceEnvelope();
		envelope.probabilistic = {
			fiCycleSuccessProbability: 0,
			selfSustainingDate: null,
			selfSustainingProbability: null,
		};
		expect(financialIndependenceRange(envelope, 400)).toEqual({
			probability: 0,
			date: null,
			dateProbability: null,
			count: 400,
		});
		envelope.probabilistic = {
			fiCycleSuccessProbability: 0.95,
			selfSustainingDate: "2035-06-01",
			selfSustainingProbability: 0.91,
		};
		expect(financialIndependenceRange(envelope, 400)).toMatchObject({
			probability: 0.95,
			dateProbability: 0.91,
			date: "2035-06-01",
		});
	});
});
