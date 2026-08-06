import { evaluationRegistry } from "../evaluation/registry";
import { EvaluationRuntimeSet } from "../evaluation/runtime";
import { addOccurrences } from "../simulation/postings";
import { prepareSimulationRequest } from "../simulation/prepareSimulation";
import {
	adaptSimulationRun,
	buildProjectionPath,
} from "../simulation/projectPath";
import { simulate } from "../simulation/simulate";
import type { IncomeDataSnapshot } from "../types/income";
import type {
	FinancialModelDocument,
	ModelOverrides,
	ProjectionPath,
	ProjectionResult,
	ProjectionRuntimeSettings,
} from "../types/model";
import type { MonteCarloSample, PreparedProjection } from "../types/simulation";
import type {
	StochasticBandRow,
	StochasticConfig,
	StochasticProgress,
	StochasticProgressPhase,
	StochasticProjectionResult,
} from "../types/stochastic";
import { projectionYearIndex } from "../utils/date";
import {
	computePercentilesFromSorted,
	createStochasticSampler,
	mergeSorted,
	normalizeStochasticConfig,
	type StochasticSampler,
} from "../utils/stochastic";

function buildStochasticRates(
	postings: FinancialModelDocument["postings"],
	sampleCountsByPostingId: ReadonlyMap<string, number>,
	sampleLogNormal: StochasticSampler,
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
	postings: FinancialModelDocument["postings"],
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
		Array<{
			posting: FinancialModelDocument["postings"][number];
			index: number;
		}>
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
const STOCHASTIC_PROGRESS_TARGET_UPDATES = 200;
const STOCHASTIC_PROGRESS_MIN_INTERVAL_MS = 250;

export function getStochasticProgressUpdateRunInterval(runCount: number) {
	return Math.max(
		1,
		Math.min(
			Math.ceil(runCount / STOCHASTIC_PROGRESS_TARGET_UPDATES),
			STOCHASTIC_PROGRESS_BATCH / 2,
		),
	);
}

export class StochasticProjectionSession {
	readonly config: StochasticConfig;
	readonly prepared: PreparedProjection;
	private readonly deterministicRaw: ReturnType<typeof adaptSimulationRun>;
	private readonly deterministic: ProjectionResult;
	private readonly runtimes: EvaluationRuntimeSet;
	private readonly sampleCountsByPostingId: ReadonlyMap<string, number>;
	private readonly sampleLogNormal: StochasticSampler;
	private readonly sortedDates: readonly string[];
	private readonly sortedValuesByDate = new Map<string, number[]>();
	private readonly pendingValuesByDate = new Map<string, number[]>();
	private readonly isHistoricalByDate = new Map<string, boolean>();
	private readonly progressUpdateRuns: number;
	private completedRuns = 0;
	private lastLightweightProgressAt = performance.now();

	constructor(
		document: FinancialModelDocument,
		projectionSettings: ProjectionRuntimeSettings,
		overrides: ModelOverrides,
		config: StochasticConfig,
		private readonly onProgress?: (
			progress: StochasticProgress,
			partial?: StochasticProjectionResult,
		) => void,
		incomeData?: IncomeDataSnapshot,
	) {
		this.config = normalizeStochasticConfig(config);
		this.progressUpdateRuns = getStochasticProgressUpdateRunInterval(
			this.config.runCount,
		);
		this.onProgress?.({
			phase: "preparing",
			completedRuns: 0,
			totalRuns: this.config.runCount,
			fraction: 0,
			evaluationWorkloads: [],
		});
		this.sampleLogNormal = createStochasticSampler(this.config.seed);
		this.prepared = prepareSimulationRequest(
			document,
			projectionSettings,
			overrides,
			undefined,
			incomeData,
		);
		this.deterministicRaw = adaptSimulationRun(
			this.prepared,
			simulate(this.prepared.request),
		);
		this.sampleCountsByPostingId = buildSampleCountsByPostingId(
			this.prepared.request.model.postings,
			projectionSettings.horizonYears,
			this.prepared.request.startDate,
			this.prepared.request.endDate,
			this.prepared.request.includeStartDateEvents,
		);
		this.runtimes = new EvaluationRuntimeSet(
			projectionSettings.evaluations,
			evaluationRegistry,
		);
		this.runtimes.prepareStochasticWork({
			path: this.deterministicRaw.path,
			document: this.deterministicRaw.path.effectiveDocument,
			detailLevel: "summary",
		});
		this.onProgress?.(this.progress("deterministic-evaluations"));
		this.runtimes.evaluateDeterministic({
			path: this.deterministicRaw.path,
			document: this.deterministicRaw.path.effectiveDocument,
			detailLevel: "summary",
		});
		this.runtimes.startStochastic();
		this.onProgress?.(this.progress("stochastic-runs"));
		this.deterministic = {
			...this.deterministicRaw.result,
			...this.runtimes.result(),
		};
		this.sortedDates = this.deterministic.timeline.rows.map((row) => row.date);
	}

	createSample(): MonteCarloSample {
		return {
			annualRatesByPostingId: buildStochasticRates(
				this.prepared.request.model.postings,
				this.sampleCountsByPostingId,
				this.sampleLogNormal,
			),
		};
	}

	projectSample(monteCarloSample: MonteCarloSample): ProjectionPath {
		return buildProjectionPath(
			this.prepared,
			simulate({ ...this.prepared.request, monteCarloSample }),
		);
	}

	consumeSample(
		path: ProjectionPath,
		monteCarloSample: MonteCarloSample,
	): void {
		if (this.completedRuns >= this.config.runCount) {
			throw new Error("Stochastic projection received too many paths.");
		}
		this.runtimes.consume({
			path,
			document: path.effectiveDocument,
			monteCarloSample,
			detailLevel: "summary",
		});
		for (const row of path.rows) {
			const values = this.pendingValuesByDate.get(row.date) ?? [];
			values.push(Math.round(row.netWorth));
			this.pendingValuesByDate.set(row.date, values);
			if (!this.isHistoricalByDate.has(row.date)) {
				this.isHistoricalByDate.set(row.date, row.isHistorical);
			}
		}

		this.completedRuns++;
		const batchComplete =
			this.completedRuns % STOCHASTIC_PROGRESS_BATCH === 0 ||
			this.completedRuns === this.config.runCount;
		if (batchComplete) {
			this.flushBatch();
			return;
		}

		const now = performance.now();
		if (
			this.completedRuns === 1 ||
			(this.completedRuns % this.progressUpdateRuns === 0 &&
				now - this.lastLightweightProgressAt >=
					STOCHASTIC_PROGRESS_MIN_INTERVAL_MS)
		) {
			this.onProgress?.(this.progress("stochastic-runs"));
			this.lastLightweightProgressAt = now;
		}
	}

	result(): StochasticProjectionResult {
		if (this.completedRuns !== this.config.runCount) {
			throw new Error(
				`Stochastic projection expected ${this.config.runCount} paths but received ${this.completedRuns}.`,
			);
		}
		return this.buildResult();
	}

	private progress(
		phase: Exclude<StochasticProgressPhase, "preparing">,
	): StochasticProgress {
		return {
			phase,
			completedRuns: this.completedRuns,
			totalRuns: this.config.runCount,
			fraction: this.completedRuns / this.config.runCount,
			evaluationWorkloads: this.runtimes.workloadProgress(
				this.completedRuns,
				this.config.runCount,
			),
		};
	}

	private flushBatch(): void {
		for (const [date, values] of this.pendingValuesByDate) {
			values.sort((left, right) => left - right);
			const existing = this.sortedValuesByDate.get(date);
			this.sortedValuesByDate.set(
				date,
				existing ? mergeSorted(existing, values) : values,
			);
		}
		this.pendingValuesByDate.clear();
		this.runtimes.finalize({
			document: this.deterministicRaw.path.effectiveDocument,
			deterministicPath: this.deterministicRaw.path,
			runCount: this.completedRuns,
		});
		this.onProgress?.(this.progress("stochastic-runs"), this.buildResult());
	}

	private buildResult(): StochasticProjectionResult {
		return buildResult(
			this.config,
			this.deterministic,
			buildBands(
				this.sortedValuesByDate,
				this.isHistoricalByDate,
				this.sortedDates,
			),
			this.runtimes,
		);
	}
}

export function stochasticProject(
	document: FinancialModelDocument,
	projectionSettings: ProjectionRuntimeSettings,
	overrides: ModelOverrides,
	config: StochasticConfig,
	onProgress?: (
		progress: StochasticProgress,
		partial?: StochasticProjectionResult,
	) => void,
	incomeData?: IncomeDataSnapshot,
): StochasticProjectionResult {
	const session = new StochasticProjectionSession(
		document,
		projectionSettings,
		overrides,
		config,
		onProgress,
		incomeData,
	);

	for (let run = 0; run < session.config.runCount; run++) {
		const sample = session.createSample();
		session.consumeSample(session.projectSample(sample), sample);
	}
	return session.result();
}
