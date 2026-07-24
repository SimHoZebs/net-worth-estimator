import { evaluationRegistry } from "../evaluation/registry";
import { EvaluationRuntimeSet } from "../evaluation/runtime";
import { prepareSimulationRequest } from "../scenario/prepareSimulation";
import { addOccurrences } from "../simulation/postings";
import {
	adaptSimulationRun,
	buildProjectionPath,
} from "../simulation/projectPath";
import { simulate } from "../simulation/simulate";
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
import { projectionYearIndex } from "../utils/date";
import {
	computePercentilesFromSorted,
	mergeSorted,
	reseed,
	sampleLogNormal,
} from "../utils/stochastic";

function buildStochasticRates(
	postings: ScenarioPack["postings"],
	sampleCountsByPostingId: ReadonlyMap<string, number>,
): Map<string, number[]> {
	const rates = new Map<string, number[]>();
	for (const posting of postings) {
		if (posting.volatility <= 0 || !posting.enabled) continue;
		rates.set(
			posting.id,
			Array.from({ length: sampleCountsByPostingId.get(posting.id) ?? 0 }, () =>
				sampleLogNormal(posting.annualRate, posting.volatility),
			),
		);
	}
	return rates;
}

export function buildSampleCountsByPostingId(
	postings: ScenarioPack["postings"],
	horizonYears: number,
	startDate: string,
	endDate: string,
	includeStartDateEvents: boolean,
): Map<string, number> {
	const sampleCounts = new Map(
		postings
			.filter((posting) => posting.enabled && posting.volatility > 0)
			.map((posting) => [posting.id, horizonYears]),
	);
	const occurrencesByDate = new Map<
		string,
		Array<{ posting: ScenarioPack["postings"][number]; index: number }>
	>();
	addOccurrences(
		postings,
		occurrencesByDate,
		startDate,
		endDate,
		includeStartDateEvents,
	);
	for (const [date, occurrences] of occurrencesByDate) {
		const requiredCount = projectionYearIndex(startDate, date) + 1;
		for (const { posting } of occurrences) {
			if (posting.volatility <= 0) continue;
			sampleCounts.set(
				posting.id,
				Math.max(sampleCounts.get(posting.id) ?? 0, requiredCount),
			);
		}
	}
	return sampleCounts;
}

function buildBands(
	sortedValuesByDate: ReadonlyMap<string, number[]>,
	isHistoricalByDate: ReadonlyMap<string, boolean>,
	sortedDates: readonly string[],
): StochasticBandRow[] {
	return sortedDates.map((date) => ({
		date,
		isHistorical: isHistoricalByDate.get(date) ?? false,
		netWorth: computePercentilesFromSorted(sortedValuesByDate.get(date) ?? []),
	}));
}

function buildResult(
	config: StochasticConfig,
	deterministic: ProjectionResult,
	bands: StochasticBandRow[],
	runtimes: EvaluationRuntimeSet,
): StochasticProjectionResult {
	return {
		config,
		deterministic,
		bands,
		milestones: {
			finalNetWorthPercentiles: bands[bands.length - 1]?.netWorth ?? {
				p10: 0,
				p25: 0,
				p50: 0,
				p75: 0,
				p90: 0,
			},
		},
		...runtimes.result(),
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
	const normalizedConfig = {
		...config,
		runCount: Number.isFinite(config.runCount)
			? Math.max(1, Math.min(10_000, Math.trunc(config.runCount)))
			: 1,
	};
	reseed(normalizedConfig.seed);
	const prepared = prepareSimulationRequest(
		pack,
		projectionSettings,
		whatIfState,
	);
	const deterministicRaw = adaptSimulationRun(
		prepared,
		simulate(prepared.request),
	);
	const sampleCountsByPostingId = buildSampleCountsByPostingId(
		prepared.request.model.postings,
		projectionSettings.horizonYears,
		prepared.request.startDate,
		prepared.request.endDate,
		prepared.request.includeStartDateEvents,
	);
	const runtimes = new EvaluationRuntimeSet(
		projectionSettings.evaluations,
		evaluationRegistry,
	);
	runtimes.evaluateDeterministic({
		path: deterministicRaw.path,
		scenario: deterministicRaw.path.effectivePack,
		detailLevel: "summary",
	});
	runtimes.startStochastic();
	const deterministic: ProjectionResult = {
		...deterministicRaw.result,
		...runtimes.result(),
	};
	const sortedDates = deterministic.timeline.rows.map((row) => row.date);
	const sortedValuesByDate = new Map<string, number[]>();
	const isHistoricalByDate = new Map<string, boolean>();

	for (
		let batchStart = 0;
		batchStart < normalizedConfig.runCount;
		batchStart += STOCHASTIC_PROGRESS_BATCH
	) {
		const batchEnd = Math.min(
			batchStart + STOCHASTIC_PROGRESS_BATCH,
			normalizedConfig.runCount,
		);
		const batchValues = new Map<string, number[]>();
		for (let run = batchStart; run < batchEnd; run++) {
			const rates = buildStochasticRates(
				prepared.request.model.postings,
				sampleCountsByPostingId,
			);
			const path = buildProjectionPath(
				prepared,
				simulate({
					...prepared.request,
					sampledAssumptions: { annualRatesByPostingId: rates },
				}),
			);
			runtimes.consume({
				path,
				scenario: path.effectivePack,
				stochasticRates: rates,
				detailLevel: "summary",
			});
			for (const row of path.rows) {
				const values = batchValues.get(row.date) ?? [];
				values.push(Math.round(row.netWorth));
				batchValues.set(row.date, values);
				if (!isHistoricalByDate.has(row.date)) {
					isHistoricalByDate.set(row.date, row.isHistorical);
				}
			}
		}
		for (const [date, values] of batchValues) {
			values.sort((left, right) => left - right);
			const existing = sortedValuesByDate.get(date);
			sortedValuesByDate.set(
				date,
				existing ? mergeSorted(existing, values) : values,
			);
		}
		runtimes.finalize({
			scenario: deterministicRaw.path.effectivePack,
			deterministicPath: deterministicRaw.path,
			runCount: batchEnd,
		});
		onProgress?.(
			batchEnd / normalizedConfig.runCount,
			buildResult(
				normalizedConfig,
				deterministic,
				buildBands(sortedValuesByDate, isHistoricalByDate, sortedDates),
				runtimes,
			),
		);
	}

	return buildResult(
		normalizedConfig,
		deterministic,
		buildBands(sortedValuesByDate, isHistoricalByDate, sortedDates),
		runtimes,
	);
}
