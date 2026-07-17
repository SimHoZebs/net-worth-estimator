import type { IsoDate, ProjectionPath, ScenarioPack } from "../types/scenario";
import { mergeSorted } from "../utils/stochastic";

export interface EvaluationContext {
	path: ProjectionPath;
	scenario: ScenarioPack;
}

export interface EvaluationDefinition<TConfig, TPathResult> {
	id: string;
	validateConfig(config: unknown): TConfig;
	evaluatePath(context: EvaluationContext, config: TConfig): TPathResult;
}

export class DatedSamplesAccumulator {
	private readonly sortedSamples = new Map<IsoDate, number[]>();

	addBatch(batch: ReadonlyMap<IsoDate, readonly number[]>): void {
		for (const [date, values] of batch) {
			const next = [...values].sort((left, right) => left - right);
			const existing = this.sortedSamples.get(date);
			this.sortedSamples.set(
				date,
				existing ? mergeSorted(existing, next) : next,
			);
		}
	}

	get(date: IsoDate): readonly number[] {
		return this.sortedSamples.get(date) ?? [];
	}
}

export class CandidateSuccessAccumulator {
	private readonly counts: Uint32Array;

	constructor(candidateCount: number) {
		this.counts = new Uint32Array(candidateCount);
	}

	add(outcomes: readonly { cycleEstablished: boolean }[]): void {
		if (outcomes.length !== this.counts.length) {
			throw new Error("Evaluation returned an inconsistent candidate count.");
		}
		outcomes.forEach((outcome, index) => {
			if (outcome.cycleEstablished) this.counts[index]++;
		});
	}

	probability(index: number, runCount: number): number {
		return runCount > 0 ? (this.counts[index] ?? 0) / runCount : 0;
	}
}
