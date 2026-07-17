import type {
	ProjectionResult,
	ProjectionRuntimeSettings,
	ScenarioPack,
	ScenarioWhatIfState,
} from "../types/scenario";
import type {
	StochasticBandRow,
	StochasticConfig,
	StochasticProjectionResult,
} from "../types/stochastic";
import {
	computePercentilesFromSorted,
	mergeSorted,
	reseed,
	sampleLogNormal,
} from "../utils/stochastic";
import {
	CandidateSuccessAccumulator,
	DatedSamplesAccumulator,
} from "./evaluationRuntime";
import { projectScenarioPack } from "./scenarioProject";

function clonePack(pack: ScenarioPack): ScenarioPack {
	return {
		...pack,
		accounts: pack.accounts.map((a) => ({ ...a })),
		checkpoints: pack.checkpoints.map((c) => ({ ...c })),
		postings: pack.postings.map((p) => ({
			...p,
			destinations: p.destinations ? [...p.destinations] : null,
		})),
	};
}

function generateYearlyRates(
	expectedReturn: number,
	volatility: number,
	yearCount: number,
): number[] {
	const rates: number[] = [];
	for (let i = 0; i < yearCount; i++) {
		rates.push(sampleLogNormal(expectedReturn, volatility));
	}
	return rates;
}

function buildStochasticRates(
	pack: ScenarioPack,
	projectionSettings: ProjectionRuntimeSettings,
	whatIfState: ScenarioWhatIfState,
): Map<string, number[]> {
	const rates = new Map<string, number[]>();
	const disabledIds = new Set(whatIfState.disabledPostingIds);
	pack.postings
		.filter((posting) => !disabledIds.has(posting.id))
		.concat(whatIfState.addedPostings)
		.forEach((posting) => {
			if (posting.volatility > 0 && posting.enabled) {
				rates.set(
					posting.id,
					generateYearlyRates(
						posting.annualRate,
						posting.volatility,
						projectionSettings.horizonYears,
					),
				);
			}
		});
	return rates;
}

interface NetWorthSnapshot {
	date: string;
	netWorth: number;
	isHistorical: boolean;
}

interface RunExtraction {
	snapshots: NetWorthSnapshot[];
	coverageRatiosByDate: Map<string, number>;
	cycleEstablishedDates: Set<string>;
	hitTarget: boolean;
}

function runAndExtract(
	pack: ScenarioPack,
	projectionSettings: ProjectionRuntimeSettings,
	whatIfState: ScenarioWhatIfState,
	stochasticRates: Map<string, number[]>,
	fiCandidateDates: readonly string[],
): RunExtraction {
	const result = projectScenarioPack(
		pack,
		projectionSettings,
		whatIfState,
		stochasticRates,
		{ fiCandidateDates },
	);
	return {
		snapshots: result.timeline.rows.map((row) => ({
			date: row.date,
			netWorth: row.netWorth,
			isHistorical: row.isHistorical,
		})),
		coverageRatiosByDate: new Map(
			result.financialIndependence.rows.map((row) => [
				row.date,
				row.coverageRatio,
			]),
		),
		cycleEstablishedDates: new Set(
			result.financialIndependence.runOutcomes
				.filter((outcome) => outcome.cycleEstablished)
				.map((outcome) => outcome.candidateDate),
		),
		hitTarget: result.milestones.hitTargetDate !== null,
	};
}

function buildBandsFromSorted(
	sortedValuesByDate: Map<string, number[]>,
	isHistoricalByDate: Map<string, boolean>,
	sortedDates: string[],
): StochasticBandRow[] {
	return sortedDates.map((date) => {
		const values = sortedValuesByDate.get(date) ?? [];
		return {
			date,
			isHistorical: isHistoricalByDate.get(date) ?? false,
			netWorth: computePercentilesFromSorted(values),
		};
	});
}

function buildStochasticResult(
	bands: StochasticBandRow[],
	deterministic: ProjectionResult,
	config: StochasticConfig,
	projectionSettings: ProjectionRuntimeSettings,
	totalHitCount: number,
	totalRuns: number,
	coverageRatiosByDate: Map<string, number[]>,
	fiCycleSuccesses: CandidateSuccessAccumulator,
	successfulFiCycleRuns: number,
): StochasticProjectionResult {
	const finalRowBands = bands[bands.length - 1];
	const finalNetWorthPercentiles = finalRowBands?.netWorth ?? {
		p10: 0,
		p25: 0,
		p50: 0,
		p75: 0,
		p90: 0,
	};

	let medianHitDate: string | null = null;
	let worstCaseHitDate: string | null = null;

	bands.forEach((band) => {
		if (band.isHistorical) return;
		if (
			projectionSettings.targetNetWorth !== undefined &&
			medianHitDate === null &&
			band.netWorth.p50 >= projectionSettings.targetNetWorth
		) {
			medianHitDate = band.date;
		}
		if (
			projectionSettings.targetNetWorth !== undefined &&
			worstCaseHitDate === null &&
			band.netWorth.p10 >= projectionSettings.targetNetWorth
		) {
			worstCaseHitDate = band.date;
		}
	});

	const hitTargetProbability = totalRuns > 0 ? totalHitCount / totalRuns : 0;
	let medianFiCoverageDate: string | null = null;
	let fiSelfSustainingDate: string | null = null;
	let fiSelfSustainingProbability: number | null = null;
	const fiCycleSuccessProbability =
		totalRuns > 0 ? successfulFiCycleRuns / totalRuns : 0;
	for (const row of deterministic.financialIndependence.rows) {
		const ratios = coverageRatiosByDate.get(row.date) ?? [];
		const medianRatio = computePercentilesFromSorted(ratios).p50;
		if (
			medianFiCoverageDate === null &&
			ratios.length > 0 &&
			medianRatio >= 1
		) {
			medianFiCoverageDate = row.date;
		}
		const probability = fiCycleSuccesses.probability(
			deterministic.financialIndependence.rows.indexOf(row),
			totalRuns,
		);
		if (
			fiSelfSustainingDate === null &&
			probability >=
				projectionSettings.financialIndependencePlan.requiredConfidence
		) {
			fiSelfSustainingDate = row.date;
			fiSelfSustainingProbability = probability;
		}
	}

	return {
		config,
		deterministic,
		bands,
		milestones: {
			hitTargetProbability,
			medianHitTargetDate: medianHitDate,
			worstCaseHitTargetDate: worstCaseHitDate,
			finalNetWorthPercentiles,
			fiCycleSuccessProbability,
			medianFiCoverageDate,
			fiSelfSustainingDate,
			fiSelfSustainingProbability,
		},
	};
}

const STOCHASTIC_PROGRESS_BATCH = 50;

export function stochasticProject(
	pack: ScenarioPack,
	projectionSettings: ProjectionRuntimeSettings,
	whatIfState: ScenarioWhatIfState,
	config: StochasticConfig,
	onProgress?: (progress: number, partial: StochasticProjectionResult) => void,
): StochasticProjectionResult {
	reseed(config.seed);
	const deterministic = projectScenarioPack(
		pack,
		projectionSettings,
		whatIfState,
	);
	const fiCandidateDates = deterministic.financialIndependence.rows.map(
		(row) => row.date,
	);
	const sortedDates = deterministic.timeline.rows.map((r) => r.date);

	const sortedValuesByDate = new Map<string, number[]>();
	const isHistoricalByDate = new Map<string, boolean>();
	const coverageSamples = new DatedSamplesAccumulator();
	const fiCycleSuccesses = new CandidateSuccessAccumulator(
		fiCandidateDates.length,
	);
	let totalHitCount = 0;
	let successfulFiCycleRuns = 0;

	for (let i = 0; i < config.runCount; i += STOCHASTIC_PROGRESS_BATCH) {
		const batchEnd = Math.min(i + STOCHASTIC_PROGRESS_BATCH, config.runCount);
		const newValuesByDate = new Map<string, number[]>();
		const newCoverageByDate = new Map<string, number[]>();

		for (let j = i; j < batchEnd; j++) {
			const cloned = clonePack(pack);
			const rates = buildStochasticRates(
				cloned,
				projectionSettings,
				whatIfState,
			);
			const extraction = runAndExtract(
				cloned,
				projectionSettings,
				whatIfState,
				rates,
				fiCandidateDates,
			);

			if (extraction.hitTarget) {
				totalHitCount++;
			}

			for (const [date, ratio] of extraction.coverageRatiosByDate) {
				const ratios = newCoverageByDate.get(date) ?? [];
				ratios.push(ratio);
				newCoverageByDate.set(date, ratios);
			}
			fiCycleSuccesses.add(
				fiCandidateDates.map((date) => ({
					cycleEstablished: extraction.cycleEstablishedDates.has(date),
				})),
			);
			if (extraction.cycleEstablishedDates.size > 0) {
				successfulFiCycleRuns++;
			}

			for (const s of extraction.snapshots) {
				if (!newValuesByDate.has(s.date)) {
					newValuesByDate.set(s.date, []);
				}
				newValuesByDate.get(s.date)?.push(s.netWorth);

				if (!isHistoricalByDate.has(s.date)) {
					isHistoricalByDate.set(s.date, s.isHistorical);
				}
			}
		}

		for (const [date, newValues] of newValuesByDate) {
			newValues.sort((a, b) => a - b);
			const existing = sortedValuesByDate.get(date);
			sortedValuesByDate.set(
				date,
				existing ? mergeSorted(existing, newValues) : newValues,
			);
		}
		coverageSamples.addBatch(newCoverageByDate);

		const bands = buildBandsFromSorted(
			sortedValuesByDate,
			isHistoricalByDate,
			sortedDates,
		);
		const coverageRatiosByDate = new Map(
			fiCandidateDates.map((date) => [date, [...coverageSamples.get(date)]]),
		);
		const partial = buildStochasticResult(
			bands,
			deterministic,
			config,
			projectionSettings,
			totalHitCount,
			batchEnd,
			coverageRatiosByDate,
			fiCycleSuccesses,
			successfulFiCycleRuns,
		);
		onProgress?.(batchEnd / config.runCount, partial);
	}

	const bands = buildBandsFromSorted(
		sortedValuesByDate,
		isHistoricalByDate,
		sortedDates,
	);
	const coverageRatiosByDate = new Map(
		fiCandidateDates.map((date) => [date, [...coverageSamples.get(date)]]),
	);
	return buildStochasticResult(
		bands,
		deterministic,
		config,
		projectionSettings,
		totalHitCount,
		config.runCount,
		coverageRatiosByDate,
		fiCycleSuccesses,
		successfulFiCycleRuns,
	);
}
