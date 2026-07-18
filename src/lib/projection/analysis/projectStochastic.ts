import { evaluationRegistry } from "../evaluation/registry";
import { EvaluationRuntimeSet } from "../evaluation/runtime";
import { projectRawScenarioPack } from "../simulation/projectPath";
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

function clonePack(pack: ScenarioPack): ScenarioPack {
	return {
		...pack,
		accounts: pack.accounts.map((account) => ({ ...account })),
		checkpoints: pack.checkpoints.map((checkpoint) => ({ ...checkpoint })),
		postings: pack.postings.map((posting) => ({
			...posting,
			destinations: posting.destinations ? [...posting.destinations] : null,
		})),
	};
}

function buildStochasticRates(
	pack: ScenarioPack,
	projectionSettings: ProjectionRuntimeSettings,
	whatIfState: ScenarioWhatIfState,
): Map<string, number[]> {
	const rates = new Map<string, number[]>();
	const disabledIds = new Set(whatIfState.disabledPostingIds);
	for (const posting of pack.postings
		.filter((item) => !disabledIds.has(item.id))
		.concat(whatIfState.addedPostings)) {
		if (posting.volatility <= 0 || !posting.enabled) continue;
		rates.set(
			posting.id,
			Array.from({ length: projectionSettings.horizonYears }, () =>
				sampleLogNormal(posting.annualRate, posting.volatility),
			),
		);
	}
	return rates;
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
	reseed(config.seed);
	const deterministicRaw = projectRawScenarioPack(
		pack,
		projectionSettings,
		whatIfState,
	);
	const runtimes = new EvaluationRuntimeSet(
		projectionSettings.evaluations,
		evaluationRegistry,
	);
	runtimes.evaluateDeterministic({
		path: deterministicRaw.path,
		scenario: deterministicRaw.path.effectivePack,
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
		batchStart < config.runCount;
		batchStart += STOCHASTIC_PROGRESS_BATCH
	) {
		const batchEnd = Math.min(
			batchStart + STOCHASTIC_PROGRESS_BATCH,
			config.runCount,
		);
		const batchValues = new Map<string, number[]>();
		for (let run = batchStart; run < batchEnd; run++) {
			const cloned = clonePack(pack);
			const rates = buildStochasticRates(
				cloned,
				projectionSettings,
				whatIfState,
			);
			const raw = projectRawScenarioPack(
				cloned,
				projectionSettings,
				whatIfState,
				rates,
			);
			runtimes.consume({
				path: raw.path,
				scenario: raw.path.effectivePack,
				stochasticRates: rates,
			});
			for (const row of raw.result.timeline.rows) {
				const values = batchValues.get(row.date) ?? [];
				values.push(row.netWorth);
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
			batchEnd / config.runCount,
			buildResult(
				config,
				deterministic,
				buildBands(sortedValuesByDate, isHistoricalByDate, sortedDates),
				runtimes,
			),
		);
	}

	runtimes.finalize({
		scenario: deterministicRaw.path.effectivePack,
		deterministicPath: deterministicRaw.path,
		runCount: config.runCount,
	});
	return buildResult(
		config,
		deterministic,
		buildBands(sortedValuesByDate, isHistoricalByDate, sortedDates),
		runtimes,
	);
}
